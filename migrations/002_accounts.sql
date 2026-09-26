CREATE TABLE IF NOT EXISTS study_courses (
 id TEXT PRIMARY KEY, title TEXT NOT NULL,
 banks_json TEXT NOT NULL DEFAULT '{}', revision INTEGER NOT NULL DEFAULT 0,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO study_courses(id,title,banks_json,revision)
 SELECT 'high-school','高中英语 · 北师大版',banks_json,revision FROM shared_catalog WHERE id=1
 ON CONFLICT(id) DO NOTHING;
INSERT INTO study_courses(id,title) VALUES
 ('cet4','大学英语四级'),('cet6','大学英语六级'),('ielts','雅思英语'),('toefl','托福英语')
 ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS student_accounts (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
 password_hash TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE,
 auth_version INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS student_courses (
 student_id TEXT NOT NULL REFERENCES student_accounts(id),
 course_id TEXT NOT NULL REFERENCES study_courses(id),
 PRIMARY KEY(student_id,course_id)
);
CREATE TABLE IF NOT EXISTS student_sessions (
 token_hash TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES student_accounts(id),
 auth_version INTEGER NOT NULL, expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS student_sessions_expiry ON student_sessions(expires_at);
CREATE TABLE IF NOT EXISTS student_profiles (
 student_id TEXT NOT NULL REFERENCES student_accounts(id),
 course_id TEXT NOT NULL REFERENCES study_courses(id),
 revision INTEGER NOT NULL DEFAULT 0, profile_json TEXT NOT NULL DEFAULT 'null',
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(student_id,course_id)
);
