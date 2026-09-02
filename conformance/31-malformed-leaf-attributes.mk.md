Malformed directive syntax MUST degrade to text, never to an error, and this
covers more than just an unclosed container (fixture 09): an attribute
brace that is opened but never closed must degrade the same way, even
across a line break.

::name{attr
More text that was meant to close the brace above but never does.

A quoted attribute value left open behaves the same way:

::other{attr="unterminated
Still just text.
