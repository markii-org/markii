// The "demo" exemplar pack's prebuilt VS Code webview registration script
// (GitHub issue #3 slice 5's convention — see
// src/webview-html.ts's doc comment for the full three-step load order,
// and src/webview/pack-registry.ts for how this is consumed).
//
// A real pack's build tool would produce this file from its component
// source (Badge.tsx, alongside this file) with react/react-dom marked as
// EXTERNAL — this hand-written version stands in for that build step so
// the fixture stays small and dependency-free, but the shape (a plain
// classic script, `window.__markiiReact` used lazily, one
// `window.__markiiRegisterPack` call) is exactly what a built one must
// produce.
(function () {
  'use strict';

  var manifestJson = JSON.stringify({
    name: 'demo',
    engine: 'react',
    components: { badge: './Badge.tsx' },
  });

  // Lazy: `window.__markiiReact` is read INSIDE the render function, never
  // at the top of this file — it is only set once the main webview bundle
  // runs, which is AFTER this script (see the load-order doc comment
  // above). Reading it eagerly here would be `undefined`.
  function Badge(props) {
    var react = window.__markiiReact;
    var attributes = (props && props.attributes) || {};
    var label = attributes.label || 'demo';
    return react.createElement(
      'span',
      { className: 'mk-demo-badge', 'data-label': label },
      props ? props.children : undefined,
    );
  }

  if (typeof window.__markiiRegisterPack === 'function') {
    window.__markiiRegisterPack(manifestJson, {
      badge: { component: Badge, inline: false },
    });
  }
})();
