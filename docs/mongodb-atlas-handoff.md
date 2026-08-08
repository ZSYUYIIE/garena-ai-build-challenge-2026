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

   Keep any other backend settings in the separately ignored `.env`. Do not put
   a second populated MongoDB URI there; `.env.local` intentionally has priority.
6. From the repository root, run:

   ```powershell
   npm.cmd install
   npm.cmd run dev:dashboard
   ```

7. Open `http://127.0.0.1:5174/dashboard/account` and create or update a test
   profile. Atlas should show it in `streamsense.dashboard_accounts`.

If the Node driver times out even though Atlas marks the exact current IP as
active, check whether the current school, office, VPN, or firewall blocks
outbound Atlas database traffic. Use a permitted network or ask its
administrator to allow the Atlas endpoints; do not broaden the Atlas rule to
`0.0.0.0/0` and do not work around the block by sharing another developer's
credentials.

The dashboard-only profile needs only the MongoDB variables for account
persistence. Running the live Chrome extension, Gemini narration, or Cloud
Speech-to-Text requires separately provisioned credentials and the extension
origin configuration described in the root README.

## Data boundary

MongoDB currently stores prototype dashboard profiles only: account UUID,
display name, normalized email, entertainment preference, narration-detail
preference, and timestamps. It does not store passwords, Gemini credentials,
raw media, or the in-memory session/event history. The collection has unique
indexes for account ID and normalized email.
