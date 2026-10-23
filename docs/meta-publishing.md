# Meta publishing from the GRUBZ console

The Marketing → Social posts screen can publish to the GRUBZ Facebook Page and Instagram professional account. Facebook group destinations remain a manual copy/open workflow.

## Meta setup

1. Create or select a Meta app connected to the GRUBZ Facebook Page.
2. Link the GRUBZ Instagram professional account to that Page.
3. Issue a long-lived Page access token with the Page and Instagram publishing permissions required by Meta, including `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, and `instagram_content_publish`.
4. Record the Facebook Page ID and Instagram professional account ID.

Store the values in Firebase Secret Manager; do not put them in Firestore or browser code:

```sh
firebase functions:secrets:set META_PAGE_ACCESS_TOKEN
firebase functions:secrets:set META_FACEBOOK_PAGE_ID
firebase functions:secrets:set META_INSTAGRAM_ACCOUNT_ID
```

Then deploy the publishing function and hosting changes:

```sh
firebase deploy --only functions:adminSocialAgent,hosting
```

`META_GRAPH_API_VERSION` may be set as a function environment variable to move to a newer supported Graph API version. The implementation defaults to `v24.0`.

## Behavior

- Facebook supports text-only posts and single-image posts.
- Instagram requires a publicly reachable HTTPS image. The console uploader stores an optimized image and fills its URL automatically.
- Every publish requires an explicit confirmation.
- Successful responses store the Meta post ID, publish time, administrator UID, and permalink when Meta returns one.
- Failed attempts leave the post intact and record the latest Meta error for troubleshooting.
- Republishing an already-posted item requires a second explicit confirmation.

Meta access tokens must be rotated before expiry. The connection indicator in the console confirms only that the required secrets exist; an expired token is reported when a publish is attempted.
