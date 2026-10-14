// SPDX-License-Identifier: Apache-2.0
//! Bounded, parameterized reads of the derived note index for HTML views.

use super::Index;
use crate::error::{AppError, AppResult};
use crate::vault;
use rusqlite::{params_from_iter, types::Value as SqlValue};
use serde::{Deserialize, Serialize};

const MAX_LIMIT: usize = 200;
const MAX_RESULT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteQuery {
    pub folder: Option<String>,
    pub tag: Option<String>,
    pub property: Option<PropertyFilter>,
    /// Seconds since the Unix epoch, matching `notes.mtime`.
    pub modified_since: Option<i64>,
    pub sort: Option<NoteSort>,
    pub limit: Option<usize>,
    pub extensions: Option<Vec<String>>,
    /// Internal host aggregate queries intersect these with server-readable ids.
    pub doc_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PropertyFilter {
    pub key: String,
    pub value: serde_json::Value,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NoteSort {
    #[default]
    Path,
    Title,
    ModifiedDesc,
    ModifiedAsc,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardNote {
    pub id: String,
    pub path: String,
    pub title: String,
    pub mtime: i64,
    pub frontmatter: Option<String>,
    pub tags: Vec<String>,
}

impl Index {
    /// Local index reads never grant server permissions. The host bridge filters
    /// their output against the session's readable set before sending to HTML.
    pub fn query_notes(&self, query: &NoteQuery) -> AppResult<Vec<DashboardNote>> {
        let limit = query.limit.unwrap_or(50).min(MAX_LIMIT);
        if limit == 0 {
            return Ok(Vec::new());
        }
        let mut sql = String::from("SELECT n.id,n.path,COALESCE(n.title,''),COALESCE(n.mtime,0),n.frontmatter FROM notes n WHERE 1=1");
        let mut args: Vec<SqlValue> = Vec::new();
        if let Some(ids) = &query.doc_ids {
            if ids.is_empty() {
                return Ok(Vec::new());
            }
            if ids.len() > MAX_LIMIT || ids.iter().any(|id| id.is_empty() || id.len() > 256) {
                return Err(AppError::new("invalid query docIds"));
            }
            sql.push_str(" AND n.id IN (");
            for (i, id) in ids.iter().enumerate() {
                if i > 0 {
                    sql.push(',');
                }
                sql.push('?');
                args.push(SqlValue::Text(id.clone()));
            }
            sql.push(')');
        }
        if let Some(folder) = &query.folder {
            let folder = folder.trim_end_matches('/');
            if folder.len() > 4096
                || folder.contains('\\')
                || folder.contains(':')
                || folder.starts_with('/')
                || folder
                    .split('/')
                    .any(|s| s == "." || s == ".." || (!s.is_empty() && vault::is_ignored_name(s)))
            {
                return Err(AppError::new("invalid query folder"));
            }
            if !folder.is_empty() {
                let prefix = format!("{folder}/");
                sql.push_str(" AND lower(substr(n.path,1,?))=lower(?)");
                args.push(SqlValue::Integer(prefix.chars().count() as i64));
                args.push(SqlValue::Text(prefix));
            }
        }
        if let Some(tag) = &query.tag {
            let tag = tag.strip_prefix('#').unwrap_or(tag);
            if tag.is_empty() || tag.len() > 256 {
                return Err(AppError::new("invalid query tag"));
            }
            sql.push_str(" AND EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id=nt.tag_id WHERE nt.note_id=n.id AND t.name=? COLLATE NOCASE)");
            args.push(SqlValue::Text(tag.to_string()));
        }
        if let Some(since) = query.modified_since {
            if since < 0 {
                return Err(AppError::new("invalid modifiedSince"));
            }
            sql.push_str(" AND n.mtime>=?");
            args.push(SqlValue::Integer(since));
        }
        if let Some(exts) = &query.extensions {
            if exts.is_empty() || exts.len() > vault::NOTE_EXTS.len() {
                return Err(AppError::new("invalid extensions"));
            }
            sql.push_str(" AND (");
            for (i, ext) in exts.iter().enumerate() {
                let ext = ext.to_ascii_lowercase();
                if !vault::NOTE_EXTS.contains(&ext.as_str()) {
                    return Err(AppError::new("invalid note extension"));
                }
                if i > 0 {
                    sql.push_str(" OR ");
                }
                sql.push_str("lower(n.path) LIKE ?");
                args.push(SqlValue::Text(format!("%.{ext}")));
            }
            sql.push(')');
        }
        if let Some(prop) = &query.property {
            if prop.key.is_empty() || prop.key.len() > 256 {
                return Err(AppError::new("invalid property key"));
            }
            let (kind, value) = scalar(&prop.value)?;
            // `json_each` keys are literal, so dotted/quoted frontmatter keys do
            // not become a JSON path or SQL. Invalid historical blobs are safe.
            let numeric = kind == "integer" || kind == "real";
            sql.push_str(" AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(n.frontmatter) THEN n.frontmatter ELSE '{}' END) p WHERE p.key=? AND ((");
            args.push(SqlValue::Text(prop.key.clone()));
            if numeric {
                sql.push_str("p.type IN ('integer','real')");
            } else {
                sql.push_str("p.type=?");
                args.push(SqlValue::Text(kind.into()));
            }
            sql.push_str(" AND p.atom IS ?) OR (p.type='array' AND EXISTS (SELECT 1 FROM json_each(p.value) a WHERE ");
            args.push(value.clone());
            if numeric {
                sql.push_str("a.type IN ('integer','real')");
            } else {
                sql.push_str("a.type=?");
                args.push(SqlValue::Text(kind.into()));
            }
            sql.push_str(" AND a.atom IS ?))))");
            args.push(value);
        }
        sql.push_str(match query.sort.as_ref().unwrap_or(&NoteSort::Path) {
            NoteSort::Path => " ORDER BY n.path COLLATE NOCASE,n.id",
            NoteSort::Title => " ORDER BY n.title COLLATE NOCASE,n.path COLLATE NOCASE,n.id",
            NoteSort::ModifiedDesc => " ORDER BY n.mtime DESC,n.path COLLATE NOCASE,n.id",
            NoteSort::ModifiedAsc => " ORDER BY n.mtime ASC,n.path COLLATE NOCASE,n.id",
        });
        // Streaming rows lets ignored historical rows be skipped without an
        // unbounded result allocation, including with a property filter.
        let mut stmt = self.conn.prepare(&sql)?;
        let mut rows = stmt.query(params_from_iter(args))?;
        let mut notes = Vec::new();
        let mut result_bytes = 0;
        while let Some(row) = rows.next()? {
            let path: String = row.get(1)?;
            if vault::rel_path_is_ignored(&path) || !vault::is_note_file(&path) {
                continue;
            }
            let id: String = row.get(0)?;
            let mut note = DashboardNote {
                id,
                path,
                title: row.get(2)?,
                mtime: row.get(3)?,
                frontmatter: row.get(4)?,
                tags: Vec::new(),
            };
            result_bytes += note.id.len()
                + note.path.len()
                + note.title.len()
                + note.frontmatter.as_ref().map_or(0, String::len);
            if result_bytes > MAX_RESULT_BYTES {
                return Err(AppError::new(
                    "query result too large; narrow the filter or limit",
                ));
            }
            let mut tag_stmt = self.conn.prepare("SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id=t.id WHERE nt.note_id=? ORDER BY t.name")?;
            for tag in tag_stmt.query_map([&note.id], |r| r.get::<_, String>(0))? {
                let tag = tag?;
                result_bytes += tag.len();
                if result_bytes > MAX_RESULT_BYTES {
                    return Err(AppError::new(
                        "query result too large; narrow the filter or limit",
                    ));
                }
                note.tags.push(tag);
            }
            notes.push(note);
            if notes.len() == limit {
                break;
            }
        }
        Ok(notes)
    }
}

fn scalar(value: &serde_json::Value) -> AppResult<(&'static str, SqlValue)> {
    match value {
        serde_json::Value::Null => Ok(("null", SqlValue::Null)),
        serde_json::Value::Bool(v) => Ok((
            if *v { "true" } else { "false" },
            SqlValue::Integer(i64::from(*v)),
        )),
        serde_json::Value::String(v) if v.len() <= 4096 => Ok(("text", SqlValue::Text(v.clone()))),
        serde_json::Value::Number(v) => {
            if let Some(v) = v.as_i64() {
                Ok(("integer", SqlValue::Integer(v)))
            } else if let Some(v) = v.as_f64() {
                Ok(("real", SqlValue::Real(v)))
            } else {
                Err(AppError::new("invalid property number"))
            }
        }
        _ => Err(AppError::new(
            "property value must be a bounded JSON scalar",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notefile::write_note;

    #[test]
    fn combines_literal_folder_tag_property_and_extension_filters() {
        let dir = tempfile::tempdir().unwrap();
        write_note(
            dir.path(),
            "Projects_%/A.md",
            "---\nstatus: [active, paused]\n---\n# A\n#project",
        )
        .unwrap();
        write_note(
            dir.path(),
            "Projects_%/B.md",
            "---\nstatus: archived\n---\n# B\n#project",
        )
        .unwrap();
        write_note(
            dir.path(),
            "ProjectsXX/A.md",
            "---\nstatus: active\n---\n# C\n#project",
        )
        .unwrap();
        let index = Index::open(dir.path()).unwrap();
        index.rebuild(dir.path()).unwrap();
        let query: NoteQuery = serde_json::from_value(serde_json::json!({"folder":"projects_%","tag":"#project","property":{"key":"status","value":"active"},"extensions":["md"]})).unwrap();
        let rows = index.query_notes(&query).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].path, "Projects_%/A.md");
    }

    #[test]
    fn typed_values_do_not_coerce_strings_and_queries_are_bounded() {
        let dir = tempfile::tempdir().unwrap();
        write_note(dir.path(), "A.md", "---\nready: true\ncount: 2\n---\nA").unwrap();
        write_note(dir.path(), "B.md", "---\nready: 'true'\ncount: '2'\n---\nB").unwrap();
        let index = Index::open(dir.path()).unwrap();
        index.rebuild(dir.path()).unwrap();
        for (key, value) in [
            ("ready", serde_json::json!(true)),
            ("count", serde_json::json!(2)),
        ] {
            let q = NoteQuery {
                property: Some(PropertyFilter {
                    key: key.into(),
                    value,
                }),
                ..Default::default()
            };
            assert_eq!(index.query_notes(&q).unwrap()[0].path, "A.md");
            assert_eq!(index.query_notes(&q).unwrap().len(), 1);
        }
        assert!(index
            .query_notes(&NoteQuery {
                folder: Some(".context".into()),
                ..Default::default()
            })
            .is_err());
        assert!(index
            .query_notes(&NoteQuery {
                limit: Some(0),
                ..Default::default()
            })
            .unwrap()
            .is_empty());
        assert_eq!(
            index
                .query_notes(&NoteQuery {
                    limit: Some(1),
                    ..Default::default()
                })
                .unwrap()
                .len(),
            1
        );
        assert!(serde_json::from_str::<NoteQuery>(r#"{"sort":"sql;DROP TABLE notes"}"#).is_err());
        let only_a = index
            .query_notes(&NoteQuery {
                doc_ids: Some(vec![index.get_note_meta("A.md").unwrap().unwrap().id]),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(only_a.len(), 1);
        assert_eq!(only_a[0].path, "A.md");
        assert!(index
            .query_notes(&NoteQuery {
                doc_ids: Some(vec!["id".into(); 201]),
                ..Default::default()
            })
            .is_err());
    }

    #[test]
    fn literal_property_keys_null_and_numeric_equality_handle_bad_blobs() {
        let dir = tempfile::tempdir().unwrap();
        write_note(
            dir.path(),
            "A.md",
            "---\nscore: 2.0\nnullable: null\n'status.key': ready\n---\nA",
        )
        .unwrap();
        write_note(dir.path(), "B.md", "---\nscore: '2'\n---\nB").unwrap();
        let index = Index::open(dir.path()).unwrap();
        index.rebuild(dir.path()).unwrap();
        index
            .conn
            .execute(
                "INSERT INTO notes (id,path,frontmatter) VALUES ('bad','Bad.md','not-json')",
                [],
            )
            .unwrap();
        for (key, value) in [
            ("score", serde_json::json!(2)),
            ("nullable", serde_json::Value::Null),
            ("status.key", serde_json::json!("ready")),
        ] {
            let rows = index
                .query_notes(&NoteQuery {
                    property: Some(PropertyFilter {
                        key: key.into(),
                        value,
                    }),
                    ..Default::default()
                })
                .unwrap();
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].path, "A.md");
        }
        assert!(index
            .query_notes(&NoteQuery {
                property: Some(PropertyFilter {
                    key: "status.key' OR 1=1 --".into(),
                    value: serde_json::json!("ready")
                }),
                ..Default::default()
            })
            .unwrap()
            .is_empty());
        index
            .conn
            .execute(
                "UPDATE notes SET frontmatter=? WHERE id='bad'",
                ["x".repeat(MAX_RESULT_BYTES + 1)],
            )
            .unwrap();
        assert!(index.query_notes(&NoteQuery::default()).is_err());
    }
}
