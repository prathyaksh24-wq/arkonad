use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

const MAX_OUTPUT_BYTES: usize = 64 * 1024;
const MAX_COMMIT_MESSAGE_BYTES: usize = 4 * 1024;
const MAX_PR_BODY_BYTES: usize = 32 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryStatusRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositorySnapshot {
    pub status: String,
    pub repository_root: Option<String>,
    pub repository_name: Option<String>,
    pub branch: Option<String>,
    pub suggested_base_branch: Option<String>,
    pub dirty: bool,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub upstream: Option<String>,
    pub attention: Vec<String>,
    pub changed_files: Vec<RepositoryChangedFile>,
    pub commits: Vec<RepositoryCommit>,
    pub branches: Vec<RepositoryBranch>,
    pub worktrees: Vec<RepositoryWorktree>,
    pub reviews: Vec<RepositoryReview>,
    pub conflicts: Vec<String>,
    pub cleanup_candidates: Vec<RepositoryCleanupCandidate>,
    pub remotes: Vec<RepositoryRemote>,
    pub github: GitHubStatus,
    pub status_detail: String,
    pub refreshed_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryChangedFile {
    pub path: String,
    pub status: String,
    pub staged: bool,
    pub changed_in_worktree: bool,
    pub untracked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryCommit {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub author: String,
    pub authored_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryBranch {
    pub name: String,
    pub current: bool,
    pub upstream: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryWorktree {
    pub path: String,
    pub head: String,
    pub branch: Option<String>,
    pub detached: bool,
    pub bare: bool,
    pub dirty: bool,
    pub cleanup_eligible: bool,
    pub cleanup_reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryReview {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub state: String,
    pub is_draft: bool,
    pub review_decision: Option<String>,
    pub head_branch: String,
    pub base_branch: String,
    pub head_sha: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryCleanupCandidate {
    pub id: String,
    pub kind: String,
    pub target: String,
    pub branch: Option<String>,
    pub dirty: bool,
    pub allowed: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryRemote {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubStatus {
    pub available: bool,
    pub authenticated: bool,
    pub repository: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryCommitRequest {
    pub path: String,
    pub message: String,
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default)]
    pub include_all: bool,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryPushRequest {
    pub path: String,
    pub remote: String,
    pub branch: String,
    #[serde(default)]
    pub set_upstream: bool,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryDraftPrRequest {
    pub path: String,
    pub base_branch: String,
    pub head_branch: String,
    pub title: String,
    pub body: String,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryMergeRequest {
    pub path: String,
    pub pull_request_number: u64,
    pub method: String,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryCleanupRequest {
    pub path: String,
    pub target: String,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryActionResult {
    pub action: String,
    pub success: bool,
    pub message: String,
    pub target: String,
    pub logs: String,
    pub snapshot: Option<RepositorySnapshot>,
}

#[derive(Debug, Default)]
pub struct RepositoryRuntime {
    action_lock: Mutex<()>,
}

impl RepositoryRuntime {
    pub fn snapshot(&self, request: RepositoryStatusRequest) -> Result<RepositorySnapshot, String> {
        let path = PathBuf::from(request.path.trim());
        if path.as_os_str().is_empty() {
            return Ok(unknown_snapshot(
                "No focused directory is available.".to_owned(),
            ));
        }
        match resolve_repository_root(&path) {
            Ok(root) => inspect_repository(&root),
            Err(error) => Ok(unknown_snapshot(format!(
                "The focused directory is not a readable Git repository: {error}"
            ))),
        }
    }

    pub fn commit(
        &self,
        request: RepositoryCommitRequest,
    ) -> Result<RepositoryActionResult, String> {
        require_confirmation(request.confirmed)?;
        let _guard = self
            .action_lock
            .lock()
            .map_err(|_| "Repository actions are unavailable".to_owned())?;
        let root = resolve_repository_root(Path::new(request.path.trim()))?;
        let branch = current_branch(&root)?;
        validate_text(&request.message, "Commit message", MAX_COMMIT_MESSAGE_BYTES)?;
        if (!request.include_all && request.files.is_empty())
            || (request.include_all && !request.files.is_empty())
        {
            return Err(
                "Choose either all visible changes or one or more exact files before committing."
                    .to_owned(),
            );
        }
        let changed = parse_status(
            &run_git(
                &root,
                vec![
                    "status".to_owned(),
                    "--porcelain=v1".to_owned(),
                    "--untracked-files=all".to_owned(),
                ],
            )?
            .stdout,
        );
        if changed.is_empty() {
            return Ok(action_result(
                "commit",
                false,
                "The working tree is already clean; no commit was created.",
                format!("{branch} · {}", root.display()),
                String::new(),
                Some(inspect_repository(&root)?),
            ));
        }

        let add_args = if request.include_all {
            vec![
                "add".to_owned(),
                "-A".to_owned(),
                "--".to_owned(),
                ".".to_owned(),
            ]
        } else {
            let files = request
                .files
                .iter()
                .map(|file| validate_repository_relative_path(file))
                .collect::<Result<Vec<_>, _>>()?;
            let mut args = vec!["add".to_owned(), "--".to_owned()];
            args.extend(files);
            args
        };
        let add = run_git(&root, add_args)?;
        if !add.success {
            return Err(git_failure("Git could not stage the selected files", &add));
        }
        let staged = run_git(
            &root,
            vec![
                "diff".to_owned(),
                "--cached".to_owned(),
                "--name-only".to_owned(),
            ],
        )?;
        if !staged.success || staged.stdout.trim().is_empty() {
            return Ok(action_result(
                "commit",
                false,
                "Git staged no files, so no commit was created.",
                format!("{branch} · {}", root.display()),
                bounded_join(&[add.stdout, add.stderr, staged.stdout, staged.stderr]),
                Some(inspect_repository(&root)?),
            ));
        }
        let commit = run_git(
            &root,
            vec![
                "commit".to_owned(),
                "-m".to_owned(),
                request.message.trim().to_owned(),
            ],
        )?;
        if !commit.success {
            return Err(git_failure("Git could not create the commit", &commit));
        }
        let snapshot = inspect_repository(&root)?;
        Ok(action_result(
            "commit",
            true,
            format!("Created a commit on {branch}."),
            format!("{branch} · {}", root.display()),
            bounded_join(&[add.stdout, commit.stdout, commit.stderr]),
            Some(snapshot),
        ))
    }

    pub fn push(&self, request: RepositoryPushRequest) -> Result<RepositoryActionResult, String> {
        require_confirmation(request.confirmed)?;
        let _guard = self
            .action_lock
            .lock()
            .map_err(|_| "Repository actions are unavailable".to_owned())?;
        let root = resolve_repository_root(Path::new(request.path.trim()))?;
        let current = current_branch(&root)?;
        let branch = validate_git_name(&request.branch, "Push branch")?;
        if current != branch {
            return Err(format!(
                "Push stopped because the focused checkout is on {current}, not the requested {branch}."
            ));
        }
        let remote = validate_git_name(&request.remote, "Push remote")?;
        let remotes = remote_names(&root)?;
        if !remotes.iter().any(|candidate| candidate == &remote) {
            return Err(format!("Push remote does not exist: {remote}"));
        }
        let mut args = vec!["push".to_owned()];
        if request.set_upstream {
            args.push("--set-upstream".to_owned());
        }
        args.push(remote.clone());
        args.push(branch.clone());
        let result = run_git(&root, args)?;
        if !result.success {
            return Err(git_failure("Git push failed", &result));
        }
        Ok(action_result(
            "push",
            true,
            format!("Pushed {branch} to {remote}."),
            format!("{remote}/{branch}"),
            bounded_join(&[result.stdout, result.stderr]),
            Some(inspect_repository(&root)?),
        ))
    }

    pub fn draft_pr(
        &self,
        request: RepositoryDraftPrRequest,
    ) -> Result<RepositoryActionResult, String> {
        require_confirmation(request.confirmed)?;
        let _guard = self
            .action_lock
            .lock()
            .map_err(|_| "Repository actions are unavailable".to_owned())?;
        let root = resolve_repository_root(Path::new(request.path.trim()))?;
        let current = current_branch(&root)?;
        let head = validate_git_name(&request.head_branch, "Pull request head branch")?;
        if current != head {
            return Err(format!(
                "Draft PR creation stopped because the focused checkout is on {current}, not the requested {head}."
            ));
        }
        let base = validate_git_name(&request.base_branch, "Pull request base branch")?;
        validate_text(&request.title, "Pull request title", 512)?;
        validate_text(&request.body, "Pull request body", MAX_PR_BODY_BYTES)?;
        require_github_auth(&root)?;
        let result = run_github(
            &root,
            vec![
                "pr".to_owned(),
                "create".to_owned(),
                "--draft".to_owned(),
                "--base".to_owned(),
                base.clone(),
                "--head".to_owned(),
                head.clone(),
                "--title".to_owned(),
                request.title.trim().to_owned(),
                "--body".to_owned(),
                request.body.trim().to_owned(),
            ],
        )?;
        if !result.success {
            return Err(git_failure("Draft PR creation failed", &result));
        }
        Ok(action_result(
            "draftPr",
            true,
            format!("Created a draft PR from {head} into {base}."),
            format!("{head} → {base}"),
            bounded_join(&[result.stdout, result.stderr]),
            Some(inspect_repository(&root)?),
        ))
    }

    pub fn merge(&self, request: RepositoryMergeRequest) -> Result<RepositoryActionResult, String> {
        require_confirmation(request.confirmed)?;
        let _guard = self
            .action_lock
            .lock()
            .map_err(|_| "Repository actions are unavailable".to_owned())?;
        let root = resolve_repository_root(Path::new(request.path.trim()))?;
        let snapshot = inspect_repository(&root)?;
        let review = snapshot
            .reviews
            .iter()
            .find(|review| review.number == request.pull_request_number)
            .ok_or_else(|| {
                format!(
                    "Merge stopped because PR #{} is not attached to the focused branch.",
                    request.pull_request_number
                )
            })?;
        let method = match request.method.trim().to_ascii_lowercase().as_str() {
            "merge" => "--merge",
            "squash" => "--squash",
            "rebase" => "--rebase",
            _ => return Err("Merge method must be merge, squash, or rebase.".to_owned()),
        };
        require_github_auth(&root)?;
        let mut args = vec![
            "pr".to_owned(),
            "merge".to_owned(),
            request.pull_request_number.to_string(),
            method.to_owned(),
        ];
        if let Some(head_sha) = &review.head_sha {
            args.extend(["--match-head-commit".to_owned(), head_sha.clone()]);
        }
        let result = run_github(&root, args)?;
        if !result.success {
            return Err(git_failure("Pull request merge failed", &result));
        }
        Ok(action_result(
            "merge",
            true,
            format!(
                "Merged PR #{} without deleting its branch.",
                request.pull_request_number
            ),
            format!(
                "PR #{} · {}",
                request.pull_request_number,
                method.trim_start_matches('-')
            ),
            bounded_join(&[result.stdout, result.stderr]),
            Some(inspect_repository(&root)?),
        ))
    }

    pub fn cleanup(
        &self,
        request: RepositoryCleanupRequest,
    ) -> Result<RepositoryActionResult, String> {
        require_confirmation(request.confirmed)?;
        let _guard = self
            .action_lock
            .lock()
            .map_err(|_| "Repository actions are unavailable".to_owned())?;
        let root = resolve_repository_root(Path::new(request.path.trim()))?;
        let target = PathBuf::from(request.target.trim());
        let target = target
            .canonicalize()
            .map_err(|error| format!("cleanup target could not be resolved: {error}"))?;
        let worktrees = parse_worktrees(
            &run_git(
                &root,
                vec![
                    "worktree".to_owned(),
                    "list".to_owned(),
                    "--porcelain".to_owned(),
                ],
            )?
            .stdout,
            &root,
        );
        let candidate = worktrees
            .iter()
            .find(|worktree| same_path(Path::new(&worktree.path), &target))
            .ok_or_else(|| {
                "Cleanup stopped because the target is not a current Git Worktree. No path was removed."
                    .to_owned()
            })?;
        let primary_worktree = worktrees
            .iter()
            .find(|worktree| !worktree.bare)
            .map(|worktree| worktree.path.as_str());
        if same_path(Path::new(&candidate.path), &root)
            || primary_worktree.is_some_and(|path| same_path(Path::new(path), &target))
            || candidate.bare
        {
            return Err(
                "Cleanup stopped because the canonical or bare repository cannot be removed."
                    .to_owned(),
            );
        }
        if candidate.dirty {
            return Ok(action_result(
                "preservedChanges",
                true,
                "The Worktree contains changes, so Arkonad preserved it and did not remove user work.",
                candidate.path.clone(),
                String::new(),
                Some(inspect_repository(&root)?),
            ));
        }
        let result = run_git(
            &root,
            vec![
                "worktree".to_owned(),
                "remove".to_owned(),
                "--".to_owned(),
                candidate.path.clone(),
            ],
        )?;
        if !result.success {
            return Err(git_failure("Worktree cleanup failed", &result));
        }
        Ok(action_result(
            "removedEmptyWorktree",
            true,
            "The empty Worktree was removed. Its branch was left unchanged.",
            candidate.path.clone(),
            bounded_join(&[result.stdout, result.stderr]),
            Some(inspect_repository(&root)?),
        ))
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn repository_snapshot(
    runtime: State<'_, RepositoryRuntime>,
    request: RepositoryStatusRequest,
) -> Result<RepositorySnapshot, String> {
    runtime.snapshot(request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn repository_commit(
    runtime: State<'_, RepositoryRuntime>,
    request: RepositoryCommitRequest,
) -> Result<RepositoryActionResult, String> {
    runtime.commit(request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn repository_push(
    runtime: State<'_, RepositoryRuntime>,
    request: RepositoryPushRequest,
) -> Result<RepositoryActionResult, String> {
    runtime.push(request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn repository_create_draft_pr(
    runtime: State<'_, RepositoryRuntime>,
    request: RepositoryDraftPrRequest,
) -> Result<RepositoryActionResult, String> {
    runtime.draft_pr(request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn repository_merge_pr(
    runtime: State<'_, RepositoryRuntime>,
    request: RepositoryMergeRequest,
) -> Result<RepositoryActionResult, String> {
    runtime.merge(request)
}

#[tauri::command(rename_all = "camelCase")]
pub fn repository_cleanup_worktree(
    runtime: State<'_, RepositoryRuntime>,
    request: RepositoryCleanupRequest,
) -> Result<RepositoryActionResult, String> {
    runtime.cleanup(request)
}

fn inspect_repository(root: &Path) -> Result<RepositorySnapshot, String> {
    let branch = optional_git_output(root, vec!["branch".to_owned(), "--show-current".to_owned()]);
    let upstream = branch.as_deref().and_then(|_| {
        optional_git_output(
            root,
            vec![
                "rev-parse".to_owned(),
                "--abbrev-ref".to_owned(),
                "--symbolic-full-name".to_owned(),
                "@{upstream}".to_owned(),
            ],
        )
    });
    let (behind, ahead) = tracking_counts(root);
    let status_result = run_git(
        root,
        vec![
            "status".to_owned(),
            "--porcelain=v1".to_owned(),
            "--untracked-files=all".to_owned(),
        ],
    )?;
    if !status_result.success {
        return Err(git_failure("Git status failed", &status_result));
    }
    let changed_files = parse_status(&status_result.stdout);
    let worktrees = parse_worktrees(
        &run_git(
            root,
            vec![
                "worktree".to_owned(),
                "list".to_owned(),
                "--porcelain".to_owned(),
            ],
        )?
        .stdout,
        root,
    );
    let primary_worktree = worktrees
        .iter()
        .find(|worktree| !worktree.bare)
        .map(|worktree| worktree.path.clone());
    let cleanup_candidates = worktrees
        .iter()
        .filter(|worktree| {
            !same_path(Path::new(&worktree.path), root)
                && !worktree.bare
                && primary_worktree
                    .as_deref()
                    .map(|path| !same_path(Path::new(path), Path::new(&worktree.path)))
                    .unwrap_or(true)
        })
        .map(|worktree| RepositoryCleanupCandidate {
            id: format!("worktree:{}", worktree.path),
            kind: "worktree".to_owned(),
            target: worktree.path.clone(),
            branch: worktree.branch.clone(),
            dirty: worktree.dirty,
            allowed: worktree.cleanup_eligible,
            reason: worktree.cleanup_reason.clone(),
        })
        .collect::<Vec<_>>();
    let conflicts = parse_conflicts(
        &run_git(
            root,
            vec![
                "diff".to_owned(),
                "--name-only".to_owned(),
                "--diff-filter=U".to_owned(),
            ],
        )?
        .stdout,
    );
    let remotes = parse_remotes(
        &optional_git_output(root, vec!["remote".to_owned(), "-v".to_owned()]).unwrap_or_default(),
    );
    let github = probe_github(root, &remotes);
    let reviews = if github.available && github.authenticated && branch.is_some() {
        list_reviews(root, branch.as_deref().unwrap_or_default()).unwrap_or_default()
    } else {
        Vec::new()
    };
    let mut attention = Vec::new();
    if !changed_files.is_empty() {
        attention.push("Working tree has changes.".to_owned());
    }
    if !conflicts.is_empty() {
        attention.push(format!(
            "{} merge conflict(s) need attention.",
            conflicts.len()
        ));
    }
    if branch.is_none() {
        attention
            .push("HEAD is detached; commit and push targets need an explicit branch.".to_owned());
    } else if upstream.is_none() {
        attention.push(
            "The current branch has no upstream; push will need an explicit remote.".to_owned(),
        );
    }
    if behind.is_some_and(|value| value > 0) {
        attention.push(format!(
            "The current branch is behind its upstream by {} commit(s).",
            behind.unwrap_or_default()
        ));
    }
    if !github.authenticated {
        attention.push(github.message.clone());
    }
    for review in &reviews {
        if review.review_decision.as_deref() == Some("CHANGES_REQUESTED") {
            attention.push(format!("PR #{} has requested changes.", review.number));
        }
    }
    let repository_name = root
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned);
    let suggested_base = suggested_base_branch(root);
    Ok(RepositorySnapshot {
        status: "ready".to_owned(),
        repository_root: Some(root.to_string_lossy().into_owned()),
        repository_name,
        branch,
        suggested_base_branch: suggested_base,
        dirty: !changed_files.is_empty(),
        ahead,
        behind,
        upstream,
        attention,
        changed_files: changed_files.clone(),
        commits: parse_commits(
            &optional_git_output(
                root,
                vec![
                    "log".to_owned(),
                    "-40".to_owned(),
                    "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s".to_owned(),
                ],
            )
            .unwrap_or_default(),
        ),
        branches: parse_branches(
            &optional_git_output(
                root,
                vec![
                    "for-each-ref".to_owned(),
                    "--format=%(refname:short)%x1f%(HEAD)%x1f%(upstream:short)%x1f%(upstream:track)".to_owned(),
                    "refs/heads".to_owned(),
                ],
            )
            .unwrap_or_default(),
        ),
        worktrees,
        reviews,
        conflicts,
        cleanup_candidates,
        remotes,
        github,
        status_detail: if changed_files.is_empty() {
            "Working tree is clean.".to_owned()
        } else {
            format!("{} changed path(s) reported by Git.", changed_files.len())
        },
        refreshed_at: timestamp_millis(),
    })
}

fn unknown_snapshot(message: String) -> RepositorySnapshot {
    RepositorySnapshot {
        status: "unknown".to_owned(),
        repository_root: None,
        repository_name: None,
        branch: None,
        suggested_base_branch: None,
        dirty: false,
        ahead: None,
        behind: None,
        upstream: None,
        attention: vec![message.clone()],
        changed_files: Vec::new(),
        commits: Vec::new(),
        branches: Vec::new(),
        worktrees: Vec::new(),
        reviews: Vec::new(),
        conflicts: Vec::new(),
        cleanup_candidates: Vec::new(),
        remotes: Vec::new(),
        github: GitHubStatus {
            available: false,
            authenticated: false,
            repository: None,
            message: "GitHub actions are unavailable until a GitHub repository is focused."
                .to_owned(),
        },
        status_detail: message,
        refreshed_at: timestamp_millis(),
    }
}

fn resolve_repository_root(path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() || !path.is_dir() {
        return Err(format!("directory does not exist: {}", path.display()));
    }
    let result = run_git(
        path,
        vec!["rev-parse".to_owned(), "--show-toplevel".to_owned()],
    )?;
    if !result.success {
        return Err(git_failure("directory is not a Git repository", &result));
    }
    PathBuf::from(result.stdout.trim())
        .canonicalize()
        .map_err(|error| format!("repository root could not be resolved: {error}"))
}

fn current_branch(root: &Path) -> Result<String, String> {
    optional_git_output(root, vec!["branch".to_owned(), "--show-current".to_owned()])
        .filter(|branch| !branch.is_empty())
        .ok_or_else(|| "The focused checkout is in detached HEAD state.".to_owned())
}

fn suggested_base_branch(root: &Path) -> Option<String> {
    for remote in ["origin", "upstream"] {
        let symbolic_head = optional_git_output(
            root,
            vec![
                "symbolic-ref".to_owned(),
                "--short".to_owned(),
                format!("refs/remotes/{remote}/HEAD"),
            ],
        );
        if let Some(branch) = symbolic_head
            .as_deref()
            .and_then(|value| value.strip_prefix(&format!("{remote}/")))
            .filter(|value| !value.is_empty())
        {
            return Some(branch.to_owned());
        }
    }

    for branch in ["main", "master", "develop"] {
        let result = run_git(
            root,
            vec![
                "show-ref".to_owned(),
                "--verify".to_owned(),
                "--quiet".to_owned(),
                format!("refs/heads/{branch}"),
            ],
        );
        if result.ok().is_some_and(|result| result.success) {
            return Some(branch.to_owned());
        }
    }
    Some("main".to_owned())
}

fn optional_git_output(root: &Path, args: Vec<String>) -> Option<String> {
    run_git(root, args)
        .ok()
        .filter(|result| result.success)
        .map(|result| result.stdout.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn tracking_counts(root: &Path) -> (Option<u32>, Option<u32>) {
    let Some(result) = run_git(
        root,
        vec![
            "rev-list".to_owned(),
            "--left-right".to_owned(),
            "--count".to_owned(),
            "@{upstream}...HEAD".to_owned(),
        ],
    )
    .ok()
    .filter(|result| result.success) else {
        return (None, None);
    };
    let values = result
        .stdout
        .split_whitespace()
        .filter_map(|value| value.parse::<u32>().ok())
        .collect::<Vec<_>>();
    if values.len() == 2 {
        (Some(values[0]), Some(values[1]))
    } else {
        (None, None)
    }
}

fn parse_status(value: &str) -> Vec<RepositoryChangedFile> {
    value
        .lines()
        .filter_map(|line| {
            if line.len() < 3 {
                return None;
            }
            let mut chars = line.chars();
            let index_status = chars.next()?;
            let worktree_status = chars.next()?;
            let path = line.get(3..)?.trim().to_owned();
            if path.is_empty() {
                return None;
            }
            Some(RepositoryChangedFile {
                path,
                status: format!("{index_status}{worktree_status}"),
                staged: index_status != ' ' && index_status != '?',
                changed_in_worktree: worktree_status != ' ' && worktree_status != '?',
                untracked: index_status == '?' && worktree_status == '?',
            })
        })
        .collect()
}

fn parse_commits(value: &str) -> Vec<RepositoryCommit> {
    value
        .lines()
        .filter_map(|line| {
            let parts = line.split('\u{1f}').collect::<Vec<_>>();
            if parts.len() < 5 {
                return None;
            }
            Some(RepositoryCommit {
                hash: parts[0].to_owned(),
                short_hash: parts[1].to_owned(),
                author: parts[2].to_owned(),
                authored_at: parts[3].to_owned(),
                subject: parts[4].to_owned(),
            })
        })
        .collect()
}

fn parse_branches(value: &str) -> Vec<RepositoryBranch> {
    value
        .lines()
        .filter_map(|line| {
            let parts = line.split('\u{1f}').collect::<Vec<_>>();
            let name = parts.first()?.trim();
            if name.is_empty() {
                return None;
            }
            let (ahead, behind) = parse_track(parts.get(3).copied().unwrap_or_default());
            Some(RepositoryBranch {
                name: name.to_owned(),
                current: parts.get(1).copied().unwrap_or_default() == "*",
                upstream: parts
                    .get(2)
                    .map(|value| value.trim())
                    .filter(|value| !value.is_empty())
                    .map(str::to_owned),
                ahead,
                behind,
            })
        })
        .collect()
}

fn parse_track(value: &str) -> (Option<u32>, Option<u32>) {
    if value.trim().is_empty() || value.trim() == "[gone]" {
        return (None, None);
    }
    let ahead = value
        .split("ahead ")
        .nth(1)
        .and_then(|value| value.split([',', ']']).next())
        .and_then(|value| value.trim().parse::<u32>().ok());
    let behind = value
        .split("behind ")
        .nth(1)
        .and_then(|value| value.split([',', ']']).next())
        .and_then(|value| value.trim().parse::<u32>().ok());
    (ahead, behind)
}

fn parse_conflicts(value: &str) -> Vec<String> {
    value
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect()
}

fn parse_remotes(value: &str) -> Vec<RepositoryRemote> {
    let mut remotes = BTreeMap::new();
    for line in value.lines() {
        let parts = line.split_whitespace().collect::<Vec<_>>();
        if parts.len() >= 2 && (parts.get(2) == Some(&"(fetch)") || parts.get(2) == Some(&"(push)"))
        {
            remotes
                .entry(parts[0].to_owned())
                .or_insert_with(|| RepositoryRemote {
                    name: parts[0].to_owned(),
                    url: parts[1].to_owned(),
                });
        }
    }
    remotes.into_values().collect()
}

fn parse_worktrees(value: &str, root: &Path) -> Vec<RepositoryWorktree> {
    let mut worktrees = Vec::new();
    let mut path = None;
    let mut head = String::new();
    let mut branch = None;
    let mut bare = false;
    for line in value.lines().chain(std::iter::once("")) {
        if let Some(value) = line.strip_prefix("worktree ") {
            push_worktree(
                &mut worktrees,
                path.take(),
                head.clone(),
                branch.take(),
                bare,
                root,
            );
            path = Some(value.trim().to_owned());
            head.clear();
            bare = false;
        } else if let Some(value) = line.strip_prefix("HEAD ") {
            head = value.trim().to_owned();
        } else if let Some(value) = line.strip_prefix("branch refs/heads/") {
            branch = Some(value.trim().to_owned());
        } else if line.trim() == "bare" {
            bare = true;
        } else if line.trim().is_empty() {
            push_worktree(
                &mut worktrees,
                path.take(),
                head.clone(),
                branch.take(),
                bare,
                root,
            );
            head.clear();
            bare = false;
        }
    }
    let primary_worktree = worktrees
        .iter()
        .find(|worktree| !worktree.bare)
        .map(|worktree| worktree.path.clone());
    for worktree in &mut worktrees {
        if primary_worktree
            .as_deref()
            .is_some_and(|path| same_path(Path::new(path), Path::new(&worktree.path)))
        {
            worktree.cleanup_eligible = false;
            worktree.cleanup_reason =
                "The primary repository checkout is never a cleanup target.".to_owned();
        } else if same_path(Path::new(&worktree.path), root) {
            worktree.cleanup_eligible = false;
            worktree.cleanup_reason =
                "The focused Worktree remains in use and is not a cleanup target.".to_owned();
        }
    }
    worktrees
}

fn push_worktree(
    worktrees: &mut Vec<RepositoryWorktree>,
    path: Option<String>,
    head: String,
    branch: Option<String>,
    bare: bool,
    root: &Path,
) {
    let Some(path) = path else {
        return;
    };
    let dirty = if bare {
        false
    } else {
        repository_dirty(Path::new(&path)).unwrap_or(true)
    };
    let canonical = same_path(Path::new(&path), root);
    let cleanup_eligible = !bare && !canonical && !dirty;
    let cleanup_reason = if canonical {
        "The canonical checkout is never a cleanup target.".to_owned()
    } else if bare {
        "Bare repositories are not cleanup targets.".to_owned()
    } else if dirty {
        "Changes are present or could not be verified; Arkonad preserves this Worktree.".to_owned()
    } else {
        "The Worktree is clean and can be removed after explicit confirmation.".to_owned()
    };
    worktrees.push(RepositoryWorktree {
        path,
        head,
        detached: branch.is_none() && !bare,
        branch,
        bare,
        dirty,
        cleanup_eligible,
        cleanup_reason,
    });
}

fn repository_dirty(path: &Path) -> Option<bool> {
    let result = run_git(
        path,
        vec![
            "status".to_owned(),
            "--porcelain=v1".to_owned(),
            "--untracked-files=all".to_owned(),
        ],
    )
    .ok()?;
    result.success.then(|| !result.stdout.trim().is_empty())
}

fn remote_names(root: &Path) -> Result<Vec<String>, String> {
    let result = run_git(root, vec!["remote".to_owned()])?;
    if !result.success {
        return Err(git_failure("Git could not list remotes", &result));
    }
    Ok(result
        .stdout
        .lines()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect())
}

fn probe_github(root: &Path, remotes: &[RepositoryRemote]) -> GitHubStatus {
    let repository = remotes
        .iter()
        .find_map(|remote| github_repository_name(&remote.url));
    let version = Command::new("gh").arg("--version").output();
    if version.is_err() || !version.as_ref().is_ok_and(|output| output.status.success()) {
        return GitHubStatus {
            available: false,
            authenticated: false,
            repository: repository.clone(),
            message: "GitHub CLI is not installed. Local Git actions remain available.".to_owned(),
        };
    }
    let auth = Command::new("gh")
        .args(["auth", "status"])
        .current_dir(root)
        .output();
    if auth.is_err() || !auth.as_ref().is_ok_and(|output| output.status.success()) {
        return GitHubStatus {
            available: true,
            authenticated: false,
            repository,
            message: "GitHub CLI is not authenticated. Local Git actions remain available."
                .to_owned(),
        };
    }
    GitHubStatus {
        available: true,
        authenticated: true,
        repository: repository.clone(),
        message: if repository.is_some() {
            "GitHub actions are available after explicit confirmation.".to_owned()
        } else {
            "GitHub CLI is authenticated, but no GitHub remote was detected.".to_owned()
        },
    }
}

fn list_reviews(root: &Path, branch: &str) -> Result<Vec<RepositoryReview>, String> {
    let result = run_github(
        root,
        vec![
            "pr".to_owned(),
            "list".to_owned(),
            "--head".to_owned(),
            branch.to_owned(),
            "--state".to_owned(),
            "all".to_owned(),
            "--limit".to_owned(),
            "20".to_owned(),
            "--json".to_owned(),
            "number,title,url,state,isDraft,reviewDecision,headRefName,baseRefName,headRefOid"
                .to_owned(),
        ],
    )?;
    if !result.success {
        return Err(git_failure("GitHub PR inspection failed", &result));
    }
    let values = serde_json::from_str::<Vec<Value>>(&result.stdout)
        .map_err(|error| format!("GitHub PR response was not valid JSON: {error}"))?;
    Ok(values
        .into_iter()
        .filter_map(|value| {
            Some(RepositoryReview {
                number: value.get("number")?.as_u64()?,
                title: value.get("title")?.as_str()?.to_owned(),
                url: value.get("url")?.as_str()?.to_owned(),
                state: value.get("state")?.as_str()?.to_owned(),
                is_draft: value.get("isDraft")?.as_bool()?,
                review_decision: value
                    .get("reviewDecision")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                head_branch: value.get("headRefName")?.as_str()?.to_owned(),
                base_branch: value.get("baseRefName")?.as_str()?.to_owned(),
                head_sha: value
                    .get("headRefOid")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            })
        })
        .collect())
}

fn github_repository_name(url: &str) -> Option<String> {
    let trimmed = url.trim().trim_end_matches('/').trim_end_matches(".git");
    let candidate = if let Some(value) = trimmed.strip_prefix("git@github.com:") {
        value
    } else if let Some(value) = trimmed.strip_prefix("https://github.com/") {
        value
    } else if let Some(value) = trimmed.strip_prefix("http://github.com/") {
        value
    } else {
        return None;
    };
    let parts = candidate.split('/').collect::<Vec<_>>();
    (parts.len() == 2 && parts.iter().all(|part| !part.is_empty())).then(|| candidate.to_owned())
}

fn require_github_auth(root: &Path) -> Result<(), String> {
    let remotes = parse_remotes(
        &optional_git_output(root, vec!["remote".to_owned(), "-v".to_owned()]).unwrap_or_default(),
    );
    let status = probe_github(root, &remotes);
    if !status.available {
        return Err(
            "This GitHub action needs the gh CLI. Local Git actions remain available.".to_owned(),
        );
    }
    if !status.authenticated {
        return Err(
            "This GitHub action needs an authenticated gh CLI. Local Git actions remain available."
                .to_owned(),
        );
    }
    if status.repository.is_none() {
        return Err(
            "This GitHub action needs a GitHub remote on the focused repository.".to_owned(),
        );
    }
    Ok(())
}

fn validate_repository_relative_path(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().any(char::is_control) {
        return Err(
            "A selected repository path is empty or contains control characters.".to_owned(),
        );
    }
    let path = Path::new(value);
    let has_windows_drive_prefix = value.as_bytes().get(1) == Some(&b':');
    let has_parent_component = value
        .split(['\\', '/'])
        .any(|component| component == "." || component == "..");
    if path.is_absolute()
        || has_windows_drive_prefix
        || value.starts_with("\\\\")
        || has_parent_component
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!(
            "Selected repository path is not a safe relative path: {value}"
        ));
    }
    Ok(value.to_owned())
}

fn validate_git_name(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.starts_with('-') || value.chars().any(char::is_control) {
        return Err(format!("{label} is empty or unsafe."));
    }
    if value.chars().any(char::is_whitespace) {
        return Err(format!("{label} cannot contain whitespace."));
    }
    Ok(value.to_owned())
}

fn validate_text(value: &str, label: &str, max_bytes: usize) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{label} is required."));
    }
    if value
        .chars()
        .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err(format!("{label} contains control characters."));
    }
    if value.len() > max_bytes {
        return Err(format!("{label} is longer than the allowed limit."));
    }
    Ok(())
}

fn require_confirmation(confirmed: bool) -> Result<(), String> {
    if confirmed {
        Ok(())
    } else {
        Err(
            "The action was not confirmed. Review the exact target before changing the repository."
                .to_owned(),
        )
    }
}

fn action_result(
    action: &str,
    success: bool,
    message: impl Into<String>,
    target: impl Into<String>,
    logs: impl Into<String>,
    snapshot: Option<RepositorySnapshot>,
) -> RepositoryActionResult {
    RepositoryActionResult {
        action: action.to_owned(),
        success,
        message: message.into(),
        target: target.into(),
        logs: logs.into(),
        snapshot,
    }
}

fn run_git(root: &Path, arguments: Vec<String>) -> Result<CommandResult, String> {
    run_process("git", &arguments, root)
}

fn run_github(root: &Path, arguments: Vec<String>) -> Result<CommandResult, String> {
    let mut result = run_process_with_env("gh", &arguments, root, [("GH_PROMPT_DISABLED", "1")])?;
    if result.stdout.is_empty() && !result.stderr.is_empty() {
        result.stdout = result.stderr.clone();
    }
    Ok(result)
}

fn run_process(program: &str, arguments: &[String], root: &Path) -> Result<CommandResult, String> {
    run_process_with_env(program, arguments, root, std::iter::empty::<(&str, &str)>())
}

fn run_process_with_env<'a, I>(
    program: &str,
    arguments: &[String],
    root: &Path,
    environment: I,
) -> Result<CommandResult, String>
where
    I: IntoIterator<Item = (&'a str, &'a str)>,
{
    let output = Command::new(program)
        .args(arguments)
        .current_dir(root)
        .envs(environment)
        .output()
        .map_err(|error| format!("could not run {program}: {error}"))?;
    Ok(CommandResult {
        success: output.status.success(),
        stdout: bounded_output(&output.stdout),
        stderr: bounded_output(&output.stderr),
    })
}

struct CommandResult {
    success: bool,
    stdout: String,
    stderr: String,
}

fn git_failure(prefix: &str, result: &CommandResult) -> String {
    let detail = if result.stderr.trim().is_empty() {
        result.stdout.trim()
    } else {
        result.stderr.trim()
    };
    if detail.is_empty() {
        prefix.to_owned()
    } else {
        format!("{prefix}: {detail}")
    }
}

fn bounded_output(bytes: &[u8]) -> String {
    let value = String::from_utf8_lossy(bytes);
    if value.len() <= MAX_OUTPUT_BYTES {
        value.into_owned()
    } else {
        let mut end = MAX_OUTPUT_BYTES;
        while end > 0 && !value.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}\n[… output truncated …]", &value[..end])
    }
}

fn bounded_join(values: &[String]) -> String {
    values
        .iter()
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join("\n")
}

fn same_path(left: &Path, right: &Path) -> bool {
    let left = left.canonicalize().unwrap_or_else(|_| left.to_path_buf());
    let right = right.canonicalize().unwrap_or_else(|_| right.to_path_buf());
    #[cfg(windows)]
    {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

fn timestamp_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_status_without_treating_untracked_as_staged() {
        let files = parse_status(" M src/main.ts\nA  src/new.ts\n?? notes.txt\n");
        assert_eq!(files.len(), 3);
        assert!(files[0].changed_in_worktree);
        assert!(!files[0].staged);
        assert!(files[1].staged);
        assert!(files[2].untracked);
    }

    #[test]
    fn parses_tracking_counts_in_git_order() {
        assert_eq!(parse_track("[ahead 2, behind 1]"), (Some(2), Some(1)));
        assert_eq!(parse_track("[gone]"), (None, None));
    }

    #[test]
    fn parses_branch_tracking_metadata() {
        let branches = parse_branches(
            "main\u{1f}*\u{1f}origin/main\u{1f}[ahead 1]\nfeature\u{1f}\u{1f}\u{1f}\n",
        );
        assert_eq!(branches[0].name, "main");
        assert!(branches[0].current);
        assert_eq!(branches[0].ahead, Some(1));
        assert!(!branches[1].current);
    }

    #[test]
    fn parses_worktree_blocks_and_marks_dirty_targets() {
        let root = std::env::current_dir().expect("test cwd");
        let worktrees = parse_worktrees(
            &format!(
                "worktree {}\nHEAD abc\nbranch refs/heads/main\n\nworktree {}\nHEAD def\nbranch refs/heads/feature\n",
                root.display(),
                root.display()
            ),
            &root,
        );
        assert_eq!(worktrees.len(), 2);
        assert_eq!(worktrees[0].branch.as_deref(), Some("main"));
    }

    #[test]
    fn accepts_only_safe_relative_repository_paths() {
        assert_eq!(
            validate_repository_relative_path("src/main.ts").unwrap(),
            "src/main.ts"
        );
        assert!(validate_repository_relative_path("../outside.txt").is_err());
        assert!(validate_repository_relative_path(r"..\outside.txt").is_err());
        assert!(validate_repository_relative_path("C:\\outside.txt").is_err());
    }

    #[test]
    fn extracts_github_repository_names_from_common_remote_urls() {
        assert_eq!(
            github_repository_name("git@github.com:owner/repo.git"),
            Some("owner/repo".to_owned())
        );
        assert_eq!(
            github_repository_name("https://github.com/owner/repo"),
            Some("owner/repo".to_owned())
        );
        assert_eq!(
            github_repository_name("https://example.com/owner/repo"),
            None
        );
    }

    #[test]
    fn preserves_primary_and_focused_worktrees_from_cleanup() {
        let focused = Path::new("D:\\secondary");
        let worktrees = parse_worktrees(
            "worktree D:\\primary\nHEAD abc\nbranch refs/heads/main\n\nworktree D:\\secondary\nHEAD def\nbranch refs/heads/feature\n",
            focused,
        );
        assert!(!worktrees[0].cleanup_eligible);
        assert!(worktrees[0].cleanup_reason.contains("primary"));
        assert!(!worktrees[1].cleanup_eligible);
        assert!(worktrees[1].cleanup_reason.contains("focused"));
    }

    #[test]
    fn requires_explicit_confirmation_and_safe_git_names() {
        assert!(require_confirmation(false).is_err());
        assert!(validate_git_name("-main", "branch").is_err());
        assert!(validate_git_name("feature branch", "branch").is_err());
        assert_eq!(
            validate_git_name("feature/ui", "branch").unwrap(),
            "feature/ui"
        );
    }

    #[test]
    fn bounds_command_output_at_a_utf8_boundary() {
        let mut bytes = vec![b'a'; MAX_OUTPUT_BYTES - 1];
        bytes.extend("😀".as_bytes());
        let output = bounded_output(&bytes);
        assert!(output.ends_with("[… output truncated …]"));
    }
}
