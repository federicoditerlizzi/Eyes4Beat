CREATE TABLE IF NOT EXISTS media_uploaders (media_id TEXT NOT NULL REFERENCES media(id), email TEXT NOT NULL, PRIMARY KEY(media_id,email));
CREATE INDEX IF NOT EXISTS media_uploaders_email ON media_uploaders(email);
