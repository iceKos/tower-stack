'use strict';

const nakaLaunch = (() => {
  const sessionId = new URLSearchParams(location.search).get('session');
  const token = new URLSearchParams(location.hash.slice(1)).get('token');
  if (token !== null) history.replaceState(null, '', location.pathname + location.search);
  if (sessionId === null && token === null) return null;
  const origin = document.referrer ? new URL(document.referrer).origin : '*';
  return {
    sessionId, token,
    notify(type) {
      if (window.parent !== window) window.parent.postMessage({ source: 'nakalite-game', type }, origin);
    },
  };
})();
