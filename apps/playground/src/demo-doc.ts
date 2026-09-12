// The playground seeds its editor with a short built-in sample rather than
// the repository's README.mk.md (removed: the vault playground at
// https://sadigaxund.github.io/markii-vault/#tour is the deployed, linkable
// tour now). This app is a local dev harness only and is no longer deployed
// itself, so the sample just needs to open on `npm run dev` and show a few
// components working.
export const DEMO_DOC = `# Markii dev sample

Edit this document and the preview on the right updates as you type.

:::callout{type=info title="This is a directive"}
\`:::callout\` places a component; everything else is plain markdown.
:::

::::row{cols=2}
:::card{title="Try it"}
Change \`type=info\` above to \`warning\` or \`danger\`.
:::

:::card{title="Mark it"}
Statuses read as :badge[stable]{variant=success} or
:badge[beta]{variant=info} inline.
:::
::::

This document can also fetch its own data. Rendering never runs code, so
the script below sits inert until you click **Run scripts**:

\`\`\`lua {name=repo}
local repo = net.fetch_json("https://api.github.com/repos/facebook/react")
return { stars = repo.stargazers_count }
\`\`\`

facebook/react has :value[repo.stars] stars.
`;
