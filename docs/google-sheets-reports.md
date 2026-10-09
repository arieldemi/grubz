# Google Sheets reports

The Console Reports module creates spreadsheets in the signed-in Google user's Drive through Google OAuth. GRUBZ never receives or stores the Google access token.

## One-time Google Cloud setup

1. Enable the **Google Sheets API** in the Google Cloud project used for the OAuth client.
2. Configure the OAuth consent screen and add the GRUBZ administrators as test users while the app remains in testing.
3. Create a **Web application** OAuth client.
4. Add the production console origin and local development origin to **Authorized JavaScript origins**:
   - `https://www.grubz.gr`
   - `http://127.0.0.1:8000`
5. Set the client ID as `GOOGLE_SHEETS_OAUTH_CLIENT_ID` in the Firebase Functions environment and redeploy `adminProfitData`.

The requested OAuth scope is limited to `https://www.googleapis.com/auth/spreadsheets`. It permits creating and editing spreadsheets but does not grant general Google Drive access.
