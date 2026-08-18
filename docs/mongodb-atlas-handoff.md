# MongoDB Atlas teammate handoff

StreamSense has no separate MongoDB API key. The backend uses a MongoDB Drivers
connection string in `MONGODB_URI`; that URI contains a database username and
password and must be treated as a secret. Never paste a populated URI into chat,
Git, documentation, frontend code, screenshots, test fixtures, or logs.

## Project invitation

An existing Atlas project administrator sends the invitation from Atlas Project
Access Manager. Assign only these project roles:

- **Project Database Access Admin** — manage project database users.
- **Project Network Access Manager** — manage the project IP access list.
- **Project Data Access Read/Write** — use Data Explorer and read/write project
  data without Project Owner access.

The teammate must accept the invitation within 30 days. Their Atlas login is a
MongoDB Cloud user; it is distinct from the application database user used by
the Node.js driver. See the official [Atlas role definitions](https://www.mongodb.com/docs/atlas/reference/user-roles/)
and [Atlas invitation lifecycle](https://www.mongodb.com/docs/atlas/invitations/).

## Teammate setup

1. Accept the Atlas project invitation.
2. In **Network Access**, add only the teammate's current public IP. Do not use
   `0.0.0.0/0` for this prototype.
3. In **Database Access**, create a personal database user with a unique strong
   password and the built-in `readWrite` role limited to the `streamsense`
   database. Do not reuse another developer's database user or URI.
4. Choose **Connect > Drivers > Node.js**, copy the SRV connection string, and
   replace its username/password placeholders. URL-encode special characters in
   the password.
5. Create the ignored file `ai-voice-realtime/.env.local` with only:

   ```dotenv
   MONGODB_URI=mongodb+srv://...
   MONGODB_DB_NAME=streamsense
   ```

   If Node reports `querySrv ECONNREFUSED` while the operating system can
   resolve the cluster hostname, also add the backend-only resolver override:

   ```dotenv
   MONGODB_DNS_SERVERS=1.1.1.1,8.8.8.8
   ```

   Keep any other backend settings in the separately ignored `.env`. Do not put
   a second populated MongoDB URI there; `.env.local` intentionally has priority.
6. From the repository root, run:

   ```powershell
   npm.cmd install
   npm.cmd run dev:dashboard
   ```

7. Open `http://127.0.0.1:5174/dashboard/account` and create or update a test
   profile. Atlas should show it in `streamsense.dashboard_accounts`.

For a maintainer acceptance run with both Atlas and Gemini credentials present,
use the isolated-record semantic test. It archives uniquely identified records,
verifies Atlas Vector Search, and deletes only those exact records afterward:

```powershell
$env:STREAMSENSE_RUN_ATLAS_SEARCH_TEST='true'
node --env-file=ai-voice-realtime/.env --env-file=ai-voice-realtime/.env.local --test ai-voice-realtime/test/mongoSemanticSearch.integration.test.js
Remove-Item Env:STREAMSENSE_RUN_ATLAS_SEARCH_TEST
```

If the Node driver times out even though Atlas marks the exact current IP as
active, check whether the current school, office, VPN, or firewall blocks
outbound Atlas database traffic. Use a permitted network or ask its
administrator to allow the Atlas endpoints; do not broaden the Atlas rule to
`0.0.0.0/0` and do not work around the block by sharing another developer's
credentials.

The dashboard-only profile needs only the MongoDB variables for account
persistence. Running the live Chrome extension requires the extension-origin
configuration described in the root README; Gemini analysis/answers, semantic
embeddings, and Cloud Speech-to-Text require their separately provisioned
credentials. Chrome timeline narration consumes installed Chrome/OS voices and
does not require a provider credential.

## Data boundary

MongoDB stores two separate prototype boundaries:

- `dashboard_accounts` contains account UUID, display name, normalized email,
  entertainment preference, narration-detail preference, and timestamps. It
  has unique indexes for account ID and normalized email.
- `sessions` contains durable Live-session metadata and aggregates used by the
  Memory overview and detail routes.
- `events` contains accepted chronological events and 768-dimensional semantic
  embeddings in the same document. Memory timelines, relationship graphs, and
  semantic search read this shared durable collection.

MongoDB does not store passwords, Gemini credentials, raw media, or captured-tab
transcripts. When MongoDB is selected at startup, dashboard sessions, events,
graphs, and semantic search survive backend restarts.
