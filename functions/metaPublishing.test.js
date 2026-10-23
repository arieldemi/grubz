const test = require("node:test");
const assert = require("node:assert/strict");
const { publishFacebookPost, publishInstagramPost } = require("./metaPublishing");

function response(data, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => data };
}

test("publishes a Facebook image post to the page photos edge", async () => {
  const calls = [];
  const result = await publishFacebookPost({
    pageId: "page-1", accessToken: "secret", version: "v24.0",
    post: { content: "Hello", imageUrl: "https://example.com/post.jpg" },
    fetchImpl: async (url, options) => { calls.push({ url: String(url), options }); return response({ id: "photo-1", post_id: "page-1_post-1" }); },
  });
  assert.equal(calls[0].url, "https://graph.facebook.com/v24.0/page-1/photos");
  assert.deepEqual(JSON.parse(calls[0].options.body), { url: "https://example.com/post.jpg", caption: "Hello" });
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret");
  assert.equal(result.postId, "page-1_post-1");
});

test("publishes Instagram by creating and publishing a media container", async () => {
  const calls = [];
  const replies = [response({ id: "container-1" }), response({ id: "media-1" }), response({ id: "media-1", permalink: "https://instagram.com/p/abc/" })];
  const result = await publishInstagramPost({
    instagramAccountId: "ig-1", accessToken: "secret",
    post: { content: "Caption", imageUrl: "https://example.com/post.jpg" },
    fetchImpl: async (url, options) => { calls.push({ url: String(url), options }); return replies.shift(); },
  });
  assert.match(calls[0].url, /\/ig-1\/media$/);
  assert.deepEqual(JSON.parse(calls[1].options.body), { creation_id: "container-1" });
  assert.match(calls[2].url, /\/media-1\?fields=permalink$/);
  assert.equal(result.permalink, "https://instagram.com/p/abc/");
});

test("requires a public image for Instagram", async () => {
  await assert.rejects(() => publishInstagramPost({ instagramAccountId: "ig-1", accessToken: "secret", post: { content: "Caption" } }), /public HTTPS image URL/);
});

test("surfaces Meta API errors without leaking the token", async () => {
  await assert.rejects(() => publishFacebookPost({
    pageId: "page-1", accessToken: "top-secret", post: { content: "Hello" },
    fetchImpl: async () => response({ error: { message: "Invalid token", code: 190 } }, false, 401),
  }), error => error.message === "Invalid token" && !error.message.includes("top-secret"));
});
