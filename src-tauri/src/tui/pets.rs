use ratatui::{
    style::{Color, Style},
    text::{Line, Span},
};

pub struct SpriteColors {
    pub background: Color,
    pub primary: Color,
    pub secondary: Color,
    pub light: Color,
    pub dim: Color,
}

const GENGAR: &[&[&str]] = &[
    &[
        ".XX..........XX.",
        ".XXX........XXX.",
        ".XXXXXXXXXXXXXX.",
        "XXrrXXXXXXrrXXXX",
        "XXXXXXXXXXXXXXXX",
        ".ww.ww.ww.ww.ww.",
        "XXXXXXXXXXXXXXXX",
        ".XXXXXXXXXXXXXX.",
        "..XXX......XXX..",
        ".XXX........XXX.",
    ],
    &[
        ".XX..........XX.",
        ".XXX........XXX.",
        ".XXXXXXXXXXXXXX.",
        "XXrrXXXXXXrrXXXX",
        "XXXXXXXXXXXXXXXX",
        ".ww.ww.ww.ww.ww.",
        "XXXXXXXXXXXXXXXX",
        ".XXXXXXXXXXXXXX.",
        "..XX........XX..",
        ".XXX........XXX.",
    ],
];

const SNORLAX: &[&[&str]] = &[
    &[
        "....XXXXXXXX....",
        "...XXXXXXXXXX...",
        "...XeXXXXXXeX...",
        "...XXXXXXXXXX...",
        "..XXwwwwwwwwXX..",
        ".XXwwwwwwwwwwXX.",
        ".XXwwwwwwwwwwXX.",
        ".XXXwwwwwwwwXXX.",
        "..XX........XX..",
        ".XXX........XXX.",
    ],
    &[
        "....XXXXXXXX....",
        "...XXXXXXXXXX...",
        "...XeXXXXXXeX...",
        "...XXXXXXXXXX...",
        "..XXwwwwwwwwXX..",
        ".XXwwwwwwwwwwXX.",
        ".XXwwwwwwwwwwXX.",
        ".XXXwwwwwwwwXXX.",
        "...XX......XX...",
        "..XXX......XXX..",
    ],
];

pub fn sprite(name: &str, tick_ms: u128, colors: SpriteColors) -> Vec<Line<'static>> {
    let (frames, frame_ms) = match name {
        "gengar" => (GENGAR, 330),
        "snorlax" => (SNORLAX, 500),
        _ => return vec![],
    };
    let frame = frames[(tick_ms / frame_ms) as usize % frames.len()];
    frame
        .chunks(2)
        .map(|pair| {
            let top = pair[0];
            let bottom = pair.get(1).copied().unwrap_or("");
            Line::from(
                (0..top.chars().count())
                    .map(|index| {
                        Span::styled(
                            "▀",
                            Style::default()
                                .fg(pixel(top, index, &colors))
                                .bg(pixel(bottom, index, &colors)),
                        )
                    })
                    .collect::<Vec<_>>(),
            )
        })
        .collect()
}

fn pixel(row: &str, index: usize, colors: &SpriteColors) -> Color {
    match row.chars().nth(index).unwrap_or('.') {
        'X' => colors.primary,
        'r' => colors.secondary,
        'w' => colors.light,
        'e' => colors.dim,
        _ => colors.background,
    }
}
