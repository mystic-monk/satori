use regex::Regex;
use std::sync::OnceLock;

pub struct LinkRef {
    // The note part only — "Note", never "Note#Heading" — see
    // shared/wikilinks.ts's WikilinkRef doc comment for why: the link
    // graph resolves an edge between two notes regardless of which
    // section/block of the target is referenced, so `#fragment` (heading
    // or ^block-id) is stripped here rather than fed into note-title
    // resolution below, where it would just fail to match anything.
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
        .map(|c| {
            let raw = c[2].trim();
            let reference = raw.split('#').next().unwrap_or(raw).trim().to_string();
            LinkRef {
                reference,
                embed: c.get(1).is_some(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_a_plain_ref() {
        let refs = extract_wikilink_refs("See [[Other Note]] for more.");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].reference, "Other Note");
        assert!(!refs[0].embed);
    }

    #[test]
    fn extracts_an_embed() {
        let refs = extract_wikilink_refs("![[Diagram]]");
        assert_eq!(refs[0].reference, "Diagram");
        assert!(refs[0].embed);
    }

    #[test]
    fn strips_a_heading_fragment_leaving_just_the_note_part() {
        let refs = extract_wikilink_refs("[[Note#Heading]]");
        assert_eq!(refs[0].reference, "Note");
    }

    #[test]
    fn strips_a_block_id_fragment_leaving_just_the_note_part() {
        let refs = extract_wikilink_refs("![[Note#^abc123]]");
        assert_eq!(refs[0].reference, "Note");
        assert!(refs[0].embed);
    }

    #[test]
    fn a_fragment_survives_alongside_an_alias() {
        let refs = extract_wikilink_refs("[[Note#Heading|Custom Label]]");
        assert_eq!(refs[0].reference, "Note");
    }
}
