use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::pty::{CreateSessionRequest, SessionInfo, SessionManager};

const MIN_SPLIT_RATIO: f32 = 0.15;
const MAX_SPLIT_RATIO: f32 = 0.85;
const DEFAULT_SPLIT_RATIO: f32 = 0.5;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SplitOrientation {
    Vertical,
    Horizontal,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FocusDirection {
    Left,
    Right,
    Up,
    Down,
}

impl FocusDirection {
    fn orientation(self) -> SplitOrientation {
        match self {
            Self::Left | Self::Right => SplitOrientation::Vertical,
            Self::Up | Self::Down => SplitOrientation::Horizontal,
        }
    }

    fn is_positive(self) -> bool {
        matches!(self, Self::Right | Self::Down)
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LayoutNode {
    Leaf {
        pane_id: String,
    },
    Split {
        orientation: SplitOrientation,
        ratio: f32,
        first: Box<LayoutNode>,
        second: Box<LayoutNode>,
    },
}

impl LayoutNode {
    fn contains(&self, pane_id: &str) -> bool {
        match self {
            Self::Leaf { pane_id: id } => id == pane_id,
            Self::Split { first, second, .. } => {
                first.contains(pane_id) || second.contains(pane_id)
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FramePane {
    pub id: String,
    pub session: SessionInfo,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameTab {
    pub id: String,
    pub title: String,
    pub root: LayoutNode,
    pub panes: Vec<FramePane>,
    pub focused_pane_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameSnapshot {
    pub tabs: Vec<FrameTab>,
    pub active_tab_id: Option<String>,
    pub focused_pane_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameCloseResult {
    pub closed: bool,
    pub requires_confirmation: bool,
    pub message: String,
    pub snapshot: FrameSnapshot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg(test)]
pub enum KeyRoute {
    PassThrough,
    OpenOverlay,
    CloseOverlay,
    OverlayInput,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg(test)]
pub struct LeaderChord {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub meta: bool,
    pub key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg(test)]
pub struct KeyStroke {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub meta: bool,
    pub key: String,
}

#[cfg(test)]
pub fn route_key(leader: &LeaderChord, stroke: &KeyStroke, overlay_open: bool) -> KeyRoute {
    if overlay_open && stroke.key.eq_ignore_ascii_case("Escape") {
        return KeyRoute::CloseOverlay;
    }

    if !overlay_open
        && leader.ctrl == stroke.ctrl
        && leader.alt == stroke.alt
        && leader.shift == stroke.shift
        && leader.meta == stroke.meta
        && leader.key.eq_ignore_ascii_case(&stroke.key)
    {
        return KeyRoute::OpenOverlay;
    }

    if overlay_open {
        KeyRoute::OverlayInput
    } else {
        KeyRoute::PassThrough
    }
}

#[derive(Default)]
pub(crate) struct FrameModel {
    tabs: Vec<FrameTab>,
    active_tab_id: Option<String>,
}

impl FrameModel {
    fn snapshot(&self) -> FrameSnapshot {
        let focused_pane_id = self.active_tab().map(|tab| tab.focused_pane_id.clone());
        FrameSnapshot {
            tabs: self.tabs.clone(),
            active_tab_id: self.active_tab_id.clone(),
            focused_pane_id,
        }
    }

    fn active_tab(&self) -> Option<&FrameTab> {
        self.active_tab_id
            .as_ref()
            .and_then(|id| self.tabs.iter().find(|tab| &tab.id == id))
    }

    fn active_tab_mut(&mut self) -> Option<&mut FrameTab> {
        let id = self.active_tab_id.clone()?;
        self.tabs.iter_mut().find(|tab| tab.id == id)
    }

    fn tab_index(&self, tab_id: Option<&str>) -> Option<usize> {
        let id = tab_id.or(self.active_tab_id.as_deref())?;
        self.tabs.iter().position(|tab| tab.id == id)
    }

    fn add_tab(&mut self, tab_id: String, pane: FramePane) {
        let pane_id = pane.id.clone();
        self.tabs.push(FrameTab {
            id: tab_id.clone(),
            title: pane.session.shell.clone(),
            root: LayoutNode::Leaf {
                pane_id: pane_id.clone(),
            },
            panes: vec![pane],
            focused_pane_id: pane_id,
        });
        self.active_tab_id = Some(tab_id);
    }

    fn split_focused(
        &mut self,
        pane: FramePane,
        orientation: SplitOrientation,
    ) -> Result<(), String> {
        let tab = self
            .active_tab_mut()
            .ok_or_else(|| "no active tab to split".to_owned())?;
        let target = tab.focused_pane_id.clone();
        let root = tab.root.clone();
        let (root, changed) = split_leaf(root, &target, &pane.id, orientation);
        if !changed {
            return Err(format!("focused pane is not present: {target}"));
        }
        tab.root = root;
        tab.panes.push(pane.clone());
        tab.focused_pane_id = pane.id;
        Ok(())
    }

    fn activate_tab(&mut self, tab_id: &str) -> Result<(), String> {
        if self.tabs.iter().any(|tab| tab.id == tab_id) {
            self.active_tab_id = Some(tab_id.to_owned());
            Ok(())
        } else {
            Err(format!("unknown tab: {tab_id}"))
        }
    }

    fn focus_pane(&mut self, pane_id: &str) -> Result<(), String> {
        let Some((tab_index, _)) = self
            .tabs
            .iter()
            .enumerate()
            .find(|(_, tab)| tab.panes.iter().any(|pane| pane.id == pane_id))
        else {
            return Err(format!("unknown pane: {pane_id}"));
        };
        self.active_tab_id = Some(self.tabs[tab_index].id.clone());
        self.tabs[tab_index].focused_pane_id = pane_id.to_owned();
        Ok(())
    }

    fn focus_direction(&mut self, direction: FocusDirection) -> bool {
        let Some(tab) = self.active_tab_mut() else {
            return false;
        };
        let current = tab.focused_pane_id.clone();
        let mut rects = Vec::new();
        collect_leaf_rects(
            &tab.root,
            Rect {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
            &mut rects,
        );
        let Some((_, current_rect)) = rects.iter().find(|(id, _)| id == &current) else {
            return false;
        };
        let current_center = current_rect.center();
        let mut candidates = rects
            .into_iter()
            .filter_map(|(id, rect)| {
                if id == current {
                    return None;
                }
                let center = rect.center();
                let (primary, secondary) = match direction {
                    FocusDirection::Left if center.0 < current_center.0 => (
                        current_center.0 - center.0,
                        (current_center.1 - center.1).abs(),
                    ),
                    FocusDirection::Right if center.0 > current_center.0 => (
                        center.0 - current_center.0,
                        (current_center.1 - center.1).abs(),
                    ),
                    FocusDirection::Up if center.1 < current_center.1 => (
                        current_center.1 - center.1,
                        (current_center.0 - center.0).abs(),
                    ),
                    FocusDirection::Down if center.1 > current_center.1 => (
                        center.1 - current_center.1,
                        (current_center.0 - center.0).abs(),
                    ),
                    _ => return None,
                };
                Some((primary, secondary, id))
            })
            .collect::<Vec<_>>();
        candidates.sort_by(|left, right| {
            left.0
                .total_cmp(&right.0)
                .then_with(|| left.1.total_cmp(&right.1))
                .then_with(|| left.2.cmp(&right.2))
        });
        let Some((_, _, next)) = candidates.into_iter().next() else {
            return false;
        };
        tab.focused_pane_id = next;
        true
    }

    fn resize_focused(&mut self, direction: FocusDirection, amount: f32) -> bool {
        let Some(tab) = self.active_tab_mut() else {
            return false;
        };
        let target = tab.focused_pane_id.clone();
        resize_node(&mut tab.root, &target, direction, amount.abs().max(0.01))
    }

    fn close_focused(&mut self) -> Option<ClosedPane> {
        let tab_index = self.tab_index(None)?;
        let pane_id = self.tabs[tab_index].focused_pane_id.clone();
        let session_id = self.tabs[tab_index]
            .panes
            .iter()
            .find(|pane| pane.id == pane_id)
            .map(|pane| pane.session.id.clone())?;
        let root = self.tabs[tab_index].root.clone();
        let (root, removed) = remove_leaf(root, &pane_id);
        if !removed {
            return None;
        }

        self.tabs[tab_index].panes.retain(|pane| pane.id != pane_id);
        if let Some(root) = root {
            let next_focus = first_leaf_id(&root)?;
            self.tabs[tab_index].root = root;
            self.tabs[tab_index].focused_pane_id = next_focus;
        } else {
            self.tabs.remove(tab_index);
            self.select_neighboring_tab(tab_index);
        }

        Some(ClosedPane { session_id })
    }

    fn close_tab(&mut self, tab_id: Option<&str>) -> Option<ClosedTab> {
        let tab_index = self.tab_index(tab_id)?;
        let tab = self.tabs.remove(tab_index);
        self.select_neighboring_tab(tab_index);
        Some(ClosedTab {
            session_ids: tab.panes.into_iter().map(|pane| pane.session.id).collect(),
        })
    }

    fn select_neighboring_tab(&mut self, removed_index: usize) {
        self.active_tab_id = self
            .tabs
            .get(removed_index.min(self.tabs.len().saturating_sub(1)))
            .map(|tab| tab.id.clone());
    }

    fn session_ids_for_tab(&self, tab_id: Option<&str>) -> Option<Vec<String>> {
        let index = self.tab_index(tab_id)?;
        Some(
            self.tabs[index]
                .panes
                .iter()
                .map(|pane| pane.session.id.clone())
                .collect(),
        )
    }

    fn has_active_pane(&self) -> bool {
        self.active_tab().is_some_and(|tab| !tab.panes.is_empty())
    }

    fn validate(&self) -> Result<(), String> {
        let mut tab_ids = HashSet::new();
        let mut pane_ids = HashSet::new();
        for tab in &self.tabs {
            if !tab_ids.insert(tab.id.clone()) {
                return Err(format!("duplicate tab id: {}", tab.id));
            }
            if tab.panes.is_empty() {
                return Err(format!("tab {} has no panes", tab.id));
            }
            let mut leaves = Vec::new();
            validate_layout(&tab.root, &mut leaves)?;
            if leaves.len() != tab.panes.len() {
                return Err(format!(
                    "tab {} has {} layout leaves but {} panes",
                    tab.id,
                    leaves.len(),
                    tab.panes.len()
                ));
            }
            let expected = tab
                .panes
                .iter()
                .map(|pane| pane.id.as_str())
                .collect::<HashSet<_>>();
            if leaves.iter().any(|id| !expected.contains(id.as_str()))
                || expected.len() != leaves.len()
            {
                return Err(format!("tab {} has inconsistent layout leaves", tab.id));
            }
            if !tab.root.contains(&tab.focused_pane_id) {
                return Err(format!("tab {} focuses a missing pane", tab.id));
            }
            for pane in &tab.panes {
                if !pane_ids.insert(pane.id.clone()) {
                    return Err(format!("duplicate pane id: {}", pane.id));
                }
            }
        }
        if let Some(active_tab_id) = &self.active_tab_id {
            if !tab_ids.contains(active_tab_id) {
                return Err(format!("active tab is missing: {active_tab_id}"));
            }
        } else if !self.tabs.is_empty() {
            return Err("non-empty frame has no active tab".to_owned());
        }
        Ok(())
    }
}

#[derive(Debug)]
struct ClosedPane {
    session_id: String,
}

#[derive(Debug)]
struct ClosedTab {
    session_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy)]
struct Rect {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

impl Rect {
    fn center(self) -> (f32, f32) {
        (self.x + self.width / 2.0, self.y + self.height / 2.0)
    }
}

fn split_leaf(
    node: LayoutNode,
    target: &str,
    new_pane_id: &str,
    new_orientation: SplitOrientation,
) -> (LayoutNode, bool) {
    match node {
        LayoutNode::Leaf { pane_id } if pane_id == target => (
            LayoutNode::Split {
                orientation: new_orientation,
                ratio: DEFAULT_SPLIT_RATIO,
                first: Box::new(LayoutNode::Leaf { pane_id }),
                second: Box::new(LayoutNode::Leaf {
                    pane_id: new_pane_id.to_owned(),
                }),
            },
            true,
        ),
        LayoutNode::Leaf { pane_id } => (LayoutNode::Leaf { pane_id }, false),
        LayoutNode::Split {
            orientation,
            ratio,
            first,
            second,
        } => {
            let (first, changed) = split_leaf(*first, target, new_pane_id, new_orientation);
            if changed {
                return (
                    LayoutNode::Split {
                        orientation,
                        ratio,
                        first: Box::new(first),
                        second,
                    },
                    true,
                );
            }
            let (second, changed) = split_leaf(*second, target, new_pane_id, new_orientation);
            (
                LayoutNode::Split {
                    orientation,
                    ratio,
                    first: Box::new(first),
                    second: Box::new(second),
                },
                changed,
            )
        }
    }
}

fn remove_leaf(node: LayoutNode, target: &str) -> (Option<LayoutNode>, bool) {
    match node {
        LayoutNode::Leaf { pane_id } if pane_id == target => (None, true),
        LayoutNode::Leaf { pane_id } => (Some(LayoutNode::Leaf { pane_id }), false),
        LayoutNode::Split {
            orientation,
            ratio,
            first,
            second,
        } => {
            let first = *first;
            let second = *second;
            let (first, removed_first) = remove_leaf(first, target);
            if removed_first {
                return match first {
                    Some(first) => (
                        Some(LayoutNode::Split {
                            orientation,
                            ratio,
                            first: Box::new(first),
                            second: Box::new(second),
                        }),
                        true,
                    ),
                    None => (Some(second), true),
                };
            }
            let (second, removed_second) = remove_leaf(second, target);
            if removed_second {
                return match second {
                    Some(second) => (
                        Some(LayoutNode::Split {
                            orientation,
                            ratio,
                            first: Box::new(first.expect("unremoved first branch")),
                            second: Box::new(second),
                        }),
                        true,
                    ),
                    None => (first, true),
                };
            }
            (
                Some(LayoutNode::Split {
                    orientation,
                    ratio,
                    first: Box::new(first.expect("unremoved first branch")),
                    second: Box::new(second.expect("unremoved second branch")),
                }),
                false,
            )
        }
    }
}

fn first_leaf_id(node: &LayoutNode) -> Option<String> {
    match node {
        LayoutNode::Leaf { pane_id } => Some(pane_id.clone()),
        LayoutNode::Split { first, .. } => first_leaf_id(first),
    }
}

fn collect_leaf_rects(node: &LayoutNode, rect: Rect, output: &mut Vec<(String, Rect)>) {
    match node {
        LayoutNode::Leaf { pane_id } => output.push((pane_id.clone(), rect)),
        LayoutNode::Split {
            orientation,
            ratio,
            first,
            second,
        } => match orientation {
            SplitOrientation::Vertical => {
                let first_width = rect.width * ratio;
                collect_leaf_rects(
                    first,
                    Rect {
                        width: first_width,
                        ..rect
                    },
                    output,
                );
                collect_leaf_rects(
                    second,
                    Rect {
                        x: rect.x + first_width,
                        width: rect.width - first_width,
                        ..rect
                    },
                    output,
                );
            }
            SplitOrientation::Horizontal => {
                let first_height = rect.height * ratio;
                collect_leaf_rects(
                    first,
                    Rect {
                        height: first_height,
                        ..rect
                    },
                    output,
                );
                collect_leaf_rects(
                    second,
                    Rect {
                        y: rect.y + first_height,
                        height: rect.height - first_height,
                        ..rect
                    },
                    output,
                );
            }
        },
    }
}

fn resize_node(
    node: &mut LayoutNode,
    target: &str,
    direction: FocusDirection,
    amount: f32,
) -> bool {
    let LayoutNode::Split {
        orientation,
        ratio,
        first,
        second,
    } = node
    else {
        return false;
    };

    if first.contains(target) {
        if resize_node(first, target, direction, amount) {
            return true;
        }
    } else if second.contains(target) {
        if resize_node(second, target, direction, amount) {
            return true;
        }
    } else {
        return false;
    }

    if *orientation != direction.orientation() {
        return false;
    }

    let signed_amount = if direction.is_positive() {
        amount
    } else {
        -amount
    };
    *ratio = (*ratio + signed_amount).clamp(MIN_SPLIT_RATIO, MAX_SPLIT_RATIO);
    true
}

fn validate_layout(node: &LayoutNode, leaves: &mut Vec<String>) -> Result<(), String> {
    match node {
        LayoutNode::Leaf { pane_id } => {
            if pane_id.trim().is_empty() {
                return Err("layout contains an empty pane id".to_owned());
            }
            leaves.push(pane_id.clone());
        }
        LayoutNode::Split {
            ratio,
            first,
            second,
            ..
        } => {
            if !(*ratio >= MIN_SPLIT_RATIO && *ratio <= MAX_SPLIT_RATIO) {
                return Err(format!("split ratio is outside bounds: {ratio}"));
            }
            validate_layout(first, leaves)?;
            validate_layout(second, leaves)?;
        }
    }
    Ok(())
}

#[derive(Default)]
pub struct FrameRuntime {
    model: Mutex<FrameModel>,
    next_tab_id: AtomicU64,
    next_pane_id: AtomicU64,
}

impl FrameRuntime {
    fn snapshot(&self) -> Result<FrameSnapshot, String> {
        let model = self
            .model
            .lock()
            .map_err(|_| "frame model lock poisoned".to_owned())?;
        model.validate()?;
        Ok(model.snapshot())
    }

    fn next_tab_id(&self) -> String {
        format!("tab-{}", self.next_tab_id.fetch_add(1, Ordering::Relaxed))
    }

    fn next_pane_id(&self) -> String {
        format!("pane-{}", self.next_pane_id.fetch_add(1, Ordering::Relaxed))
    }

    fn create_tab(
        &self,
        sessions: &SessionManager,
        request: CreateSessionRequest,
        app: AppHandle,
        output: Channel<Vec<u8>>,
    ) -> Result<FrameSnapshot, String> {
        let session = sessions.create(request, app, output)?;
        let pane = FramePane {
            id: self.next_pane_id(),
            session,
        };
        let mut model = self
            .model
            .lock()
            .map_err(|_| "frame model lock poisoned".to_owned())?;
        model.add_tab(self.next_tab_id(), pane);
        model.validate()?;
        Ok(model.snapshot())
    }

    fn create_split(
        &self,
        sessions: &SessionManager,
        request: CreateSessionRequest,
        orientation: SplitOrientation,
        app: AppHandle,
        output: Channel<Vec<u8>>,
    ) -> Result<FrameSnapshot, String> {
        {
            let model = self
                .model
                .lock()
                .map_err(|_| "frame model lock poisoned".to_owned())?;
            if !model.has_active_pane() {
                return Err("no active pane to split".to_owned());
            }
        }
        let session = sessions.create(request, app, output)?;
        let session_id = session.id.clone();
        let pane = FramePane {
            id: self.next_pane_id(),
            session,
        };
        let mut model = self
            .model
            .lock()
            .map_err(|_| "frame model lock poisoned".to_owned())?;
        if let Err(error) = model.split_focused(pane, orientation) {
            let _ = sessions.close(&session_id);
            return Err(error);
        }
        model.validate()?;
        Ok(model.snapshot())
    }

    fn attach_tab(&self, session: SessionInfo) -> Result<FrameSnapshot, String> {
        let mut model = self
            .model
            .lock()
            .map_err(|_| "frame model lock poisoned".to_owned())?;
        model.add_tab(
            self.next_tab_id(),
            FramePane {
                id: self.next_pane_id(),
                session,
            },
        );
        model.validate()?;
        Ok(model.snapshot())
    }

    fn focus_pane(&self, pane_id: &str) -> Result<FrameSnapshot, String> {
        let mut model = self
            .model
            .lock()
            .map_err(|_| "frame model lock poisoned".to_owned())?;
        model.focus_pane(pane_id)?;
        model.validate()?;
        Ok(model.snapshot())
    }

    fn activate_tab(&self, tab_id: &str) -> Result<FrameSnapshot, String> {
        let mut model = self
            .model
            .lock()
            .map_err(|_| "frame model lock poisoned".to_owned())?;
        model.activate_tab(tab_id)?;
        model.validate()?;
        Ok(model.snapshot())
    }

    fn focus_direction(&self, direction: FocusDirection) -> Result<FrameSnapshot, String> {
        let mut model = self
            .model
            .lock()
            .map_err(|_| "frame model lock poisoned".to_owned())?;
        model.focus_direction(direction);
        model.validate()?;
        Ok(model.snapshot())
    }

    fn resize_focused(
        &self,
        direction: FocusDirection,
        amount: f32,
    ) -> Result<FrameSnapshot, String> {
        let mut model = self
            .model
            .lock()
            .map_err(|_| "frame model lock poisoned".to_owned())?;
        model.resize_focused(direction, amount);
        model.validate()?;
        Ok(model.snapshot())
    }

    fn close_focused(
        &self,
        sessions: &SessionManager,
        force: bool,
    ) -> Result<FrameCloseResult, String> {
        let session_id = {
            let model = self
                .model
                .lock()
                .map_err(|_| "frame model lock poisoned".to_owned())?;
            model
                .active_tab()
                .and_then(|tab| tab.panes.iter().find(|pane| pane.id == tab.focused_pane_id))
                .map(|pane| pane.session.id.clone())
        };
        let Some(session_id) = session_id else {
            return Ok(FrameCloseResult {
                closed: false,
                requires_confirmation: false,
                message: "There is no focused pane to close.".to_owned(),
                snapshot: self.snapshot()?,
            });
        };
        if !force && sessions.is_running(&session_id) {
            return Ok(FrameCloseResult {
                closed: false,
                requires_confirmation: true,
                message: "The focused session is still running. Close its process and pane?"
                    .to_owned(),
                snapshot: self.snapshot()?,
            });
        }
        let closed = {
            let mut model = self
                .model
                .lock()
                .map_err(|_| "frame model lock poisoned".to_owned())?;
            model.close_focused()
        };
        let Some(closed) = closed else {
            return Err("the focused pane disappeared before it could close".to_owned());
        };
        let _ = sessions.close(&closed.session_id);
        Ok(FrameCloseResult {
            closed: true,
            requires_confirmation: false,
            message: "Focused pane closed.".to_owned(),
            snapshot: self.snapshot()?,
        })
    }

    fn close_tab(
        &self,
        sessions: &SessionManager,
        tab_id: Option<&str>,
        force: bool,
    ) -> Result<FrameCloseResult, String> {
        let session_ids = {
            let model = self
                .model
                .lock()
                .map_err(|_| "frame model lock poisoned".to_owned())?;
            model.session_ids_for_tab(tab_id)
        };
        let Some(session_ids) = session_ids else {
            return Ok(FrameCloseResult {
                closed: false,
                requires_confirmation: false,
                message: "There is no tab to close.".to_owned(),
                snapshot: self.snapshot()?,
            });
        };
        if !force && session_ids.iter().any(|id| sessions.is_running(id)) {
            return Ok(FrameCloseResult {
                closed: false,
                requires_confirmation: true,
                message: "This tab has running sessions. Close its processes and tab?".to_owned(),
                snapshot: self.snapshot()?,
            });
        }
        let closed = {
            let mut model = self
                .model
                .lock()
                .map_err(|_| "frame model lock poisoned".to_owned())?;
            model.close_tab(tab_id)
        };
        let Some(closed) = closed else {
            return Err("the tab disappeared before it could close".to_owned());
        };
        for session_id in closed.session_ids {
            let _ = sessions.close(&session_id);
        }
        Ok(FrameCloseResult {
            closed: true,
            requires_confirmation: false,
            message: "Tab closed.".to_owned(),
            snapshot: self.snapshot()?,
        })
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn frame_snapshot(state: State<'_, FrameRuntime>) -> Result<FrameSnapshot, String> {
    state.snapshot()
}

#[tauri::command(rename_all = "camelCase")]
pub fn frame_create_tab(
    state: State<'_, FrameRuntime>,
    sessions: State<'_, SessionManager>,
    app: AppHandle,
    request: CreateSessionRequest,
    on_output: Channel<Vec<u8>>,
) -> Result<FrameSnapshot, String> {
    state.create_tab(&sessions, request, app, on_output)
}

#[tauri::command(rename_all = "camelCase")]
pub fn frame_create_split(
    state: State<'_, FrameRuntime>,
    sessions: State<'_, SessionManager>,
    app: AppHandle,
    request: CreateSessionRequest,
    orientation: SplitOrientation,
    on_output: Channel<Vec<u8>>,
) -> Result<FrameSnapshot, String> {
    state.create_split(&sessions, request, orientation, app, on_output)
}

#[tauri::command(rename_all = "camelCase")]
pub fn frame_attach_session(
    state: State<'_, FrameRuntime>,
    session: SessionInfo,
) -> Result<FrameSnapshot, String> {
    state.attach_tab(session)
}

#[tauri::command(rename_all = "camelCase")]
pub fn frame_activate_tab(
    state: State<'_, FrameRuntime>,
    tab_id: String,
) -> Result<FrameSnapshot, String> {
    state.activate_tab(&tab_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn frame_focus_pane(
    state: State<'_, FrameRuntime>,
    pane_id: String,
) -> Result<FrameSnapshot, String> {
    state.focus_pane(&pane_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn frame_focus_move(
    state: State<'_, FrameRuntime>,
    direction: FocusDirection,
) -> Result<FrameSnapshot, String> {
    state.focus_direction(direction)
}

#[tauri::command(rename_all = "camelCase")]
pub fn frame_resize_split(
    state: State<'_, FrameRuntime>,
    direction: FocusDirection,
    amount: f32,
) -> Result<FrameSnapshot, String> {
    state.resize_focused(direction, amount)
}

#[tauri::command(rename_all = "camelCase")]
pub fn frame_close_focused(
    state: State<'_, FrameRuntime>,
    sessions: State<'_, SessionManager>,
    force: bool,
) -> Result<FrameCloseResult, String> {
    state.close_focused(&sessions, force)
}

#[tauri::command(rename_all = "camelCase")]
pub fn frame_close_tab(
    state: State<'_, FrameRuntime>,
    sessions: State<'_, SessionManager>,
    tab_id: Option<String>,
    force: bool,
) -> Result<FrameCloseResult, String> {
    state.close_tab(&sessions, tab_id.as_deref(), force)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(id: &str, shell: &str) -> SessionInfo {
        SessionInfo {
            id: id.to_owned(),
            shell: shell.to_owned(),
            cwd: r"C:\workspace".to_owned(),
        }
    }

    fn pane(id: &str, session_id: &str) -> FramePane {
        FramePane {
            id: id.to_owned(),
            session: session(session_id, "PowerShell 7"),
        }
    }

    fn model_with_tab() -> FrameModel {
        let mut model = FrameModel::default();
        model.add_tab("tab-1".to_owned(), pane("pane-1", "session-1"));
        model
    }

    #[test]
    fn recursive_layout_supports_split_focus_resize_and_close() {
        let mut model = model_with_tab();
        model
            .split_focused(pane("pane-2", "session-2"), SplitOrientation::Vertical)
            .expect("first split should be accepted");
        model
            .split_focused(pane("pane-3", "session-3"), SplitOrientation::Horizontal)
            .expect("nested split should be accepted");
        model.validate().expect("split tree should remain valid");

        assert!(model.focus_direction(FocusDirection::Left));
        assert_eq!(model.active_tab().unwrap().focused_pane_id, "pane-1");
        assert!(model.resize_focused(FocusDirection::Right, 0.1));
        model.validate().expect("resize should preserve invariants");

        let closed = model.close_focused().expect("focused pane should close");
        assert_eq!(closed.session_id, "session-1");
        model.validate().expect("close should preserve invariants");
        assert_eq!(model.active_tab().unwrap().panes.len(), 2);
    }

    #[test]
    fn focus_move_uses_geometry_and_stays_in_the_active_tab() {
        let mut model = model_with_tab();
        model
            .split_focused(pane("pane-2", "session-2"), SplitOrientation::Vertical)
            .expect("split should be accepted");
        assert_eq!(model.active_tab().unwrap().focused_pane_id, "pane-2");
        assert!(model.focus_direction(FocusDirection::Left));
        assert_eq!(model.active_tab().unwrap().focused_pane_id, "pane-1");
        assert!(!model.focus_direction(FocusDirection::Up));
    }

    #[test]
    fn closing_the_last_pane_closes_the_tab_and_selects_a_neighbor() {
        let mut model = model_with_tab();
        model.add_tab("tab-2".to_owned(), pane("pane-2", "session-2"));
        model.activate_tab("tab-1").expect("tab should exist");
        let closed = model.close_focused().expect("last pane should close");
        assert_eq!(closed.session_id, "session-1");
        assert_eq!(model.active_tab_id.as_deref(), Some("tab-2"));
        model
            .validate()
            .expect("tab removal should preserve invariants");
    }

    #[test]
    fn key_routing_only_captures_the_configured_leader() {
        let leader = LeaderChord {
            ctrl: true,
            alt: false,
            shift: false,
            meta: false,
            key: "Space".to_owned(),
        };
        let leader_stroke = KeyStroke {
            ctrl: true,
            alt: false,
            shift: false,
            meta: false,
            key: "space".to_owned(),
        };
        let ordinary_stroke = KeyStroke {
            ctrl: true,
            alt: false,
            shift: false,
            meta: false,
            key: "k".to_owned(),
        };
        assert_eq!(
            route_key(&leader, &leader_stroke, false),
            KeyRoute::OpenOverlay
        );
        assert_eq!(
            route_key(&leader, &ordinary_stroke, false),
            KeyRoute::PassThrough
        );
        assert_eq!(
            route_key(
                &leader,
                &KeyStroke {
                    key: "Escape".to_owned(),
                    ..ordinary_stroke.clone()
                },
                true
            ),
            KeyRoute::CloseOverlay
        );
        assert_eq!(
            route_key(&leader, &ordinary_stroke, true),
            KeyRoute::OverlayInput
        );
    }

    #[test]
    fn layout_validation_rejects_bad_split_ratios() {
        let mut model = model_with_tab();
        model.tabs[0].root = LayoutNode::Split {
            orientation: SplitOrientation::Vertical,
            ratio: 0.01,
            first: Box::new(LayoutNode::Leaf {
                pane_id: "pane-1".to_owned(),
            }),
            second: Box::new(LayoutNode::Leaf {
                pane_id: "pane-2".to_owned(),
            }),
        };
        assert!(model.validate().is_err());
    }
}
