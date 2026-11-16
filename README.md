This repo supports a safe repo-write mode for generated files.

- Set `ALLOW_REPO_WRITE=true` in the backend environment.
- Set `REPO_WRITE_DIR` to the absolute local checkout path of this repository.
- Only call `/api/agent/write` with `approved: true`.
- The server will write files only under the repo root, never above it.
- The write is for generated artifact review and must be followed by a git diff / commit review by a human.

## Example

```
curl -X POST https://YOUR-API/api/agent/write \
  -H 'Content-Type: application/json' \
  -d '{
    "approved": true,
    "files": [{"path":"demo.txt","content":"hello from repo write"}]
  }'
```
