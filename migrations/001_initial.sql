CREATE TABLE IF NOT EXISTS shared_catalog (
 id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL,
 banks_json TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO shared_catalog(id,revision,banks_json) VALUES(1,0,'{}') ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS learning_events (
 learner_key TEXT NOT NULL CHECK(length(learner_key)=64), id TEXT NOT NULL,
 session_id TEXT NOT NULL,word_id TEXT,
 event_type TEXT NOT NULL CHECK(event_type IN ('introduced','answered','completed')),
 exercise_type TEXT CHECK(exercise_type IN ('intro','recognize','spell','cloze','listen')),
 result TEXT CHECK(result IN ('seen','correct','incorrect','assisted','skipped')),
 assisted INTEGER NOT NULL DEFAULT 0 CHECK(assisted IN (0,1)),
 occurred_at BIGINT NOT NULL,latency_ms INTEGER NOT NULL DEFAULT 0 CHECK(latency_ms BETWEEN 0 AND 3600000),
 received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(learner_key,id)
);
CREATE INDEX IF NOT EXISTS learning_events_learner_time ON learning_events(learner_key,occurred_at);
CREATE INDEX IF NOT EXISTS learning_events_learner_word ON learning_events(learner_key,word_id);
