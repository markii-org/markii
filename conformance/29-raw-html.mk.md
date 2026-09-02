Raw HTML MUST NOT be rendered. The parser still recognizes it as an `html`
node so the rest of the document keeps flowing around it; a renderer is the
one that must drop the node (pinned separately at the hast-conversion
stage, since this fixture only checks the parsed tree).

<div class="raw">This block stays out of the rendered document.</div>

Ordinary content continues normally after it.

::callout{type=info title="Still works"}
