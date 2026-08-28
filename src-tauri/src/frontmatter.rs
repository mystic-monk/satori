use regex::Regex;
use serde_json::{Map, Value};
use std::sync::OnceLock;

fn frontmatter_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)^---\r?\n(.*?)\r?\n---\r?\n?").unwrap())
}

pub struct ParsedFrontmatter {
    pub data: Map<String, Value>,
    pub body: String,
}

/// Same `---`-fenced YAML convention as src/frontmatter.ts (the browser
/// side) and server/vault.ts (gray-matter, in the Node deployment) — three
/// independent implementations of one simple format, kept in sync by hand
/// rather than shared code, since they're in three different languages.
pub fn parse(raw: &str) -> ParsedFrontmatter {
    match frontmatter_re().captures(raw) {
        Some(caps) => {
            let yaml_str = &caps[1];
            let data = serde_yaml::from_str::<Value>(yaml_str)
                .ok()
                .and_then(|v| v.as_object().cloned())
                .unwrap_or_default();
            let body = raw[caps.get(0).unwrap().end()..].to_string();
            ParsedFrontmatter { data, body }
        }
        None => ParsedFrontmatter {
            data: Map::new(),
            body: raw.to_string(),
        },
    }
}

