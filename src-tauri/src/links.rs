use regex::Regex;
use std::sync::OnceLock;

pub struct LinkRef {
    pub reference: String,
    pub embed: bool,
}

fn wikilink_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // Same pattern as server/links.ts / src/markdown.ts's extractWikilinkRefs.
    RE.get_or_init(|| Regex::new(r"(!)?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]").unwrap())
}

pub fn extract_wikilink_refs(body: &str) -> Vec<LinkRef> {
    wikilink_re()
        .captures_iter(body)
        .map(|c| LinkRef {
            reference: c[2].trim().to_string(),
            embed: c.get(1).is_some(),
        })
        .collect()
}
