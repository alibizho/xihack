import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";

test("assistant Markdown renders CommonMark while raw HTML and unsafe links stay inert", () => {
  const markup = renderToStaticMarkup(createElement(
    Markdown,
    null,
    "# Plan\n\n**Review first**\n\n<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert(1))",
  ));
  assert.match(markup, /<h1>Plan<\/h1>/);
  assert.match(markup, /<strong>Review first<\/strong>/);
  assert.doesNotMatch(markup, /<img\b/i);
  assert.doesNotMatch(markup, /href="javascript:/i);
  assert.doesNotMatch(markup, /dangerouslySetInnerHTML/i);
});
