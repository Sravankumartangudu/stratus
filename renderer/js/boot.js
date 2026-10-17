// boot.js — load the saved org (or seed a fresh one), then draw the app.
(async () => {
  try {
    DB.boot(await window.host.loadOrg());
    await Shell.start();
  } catch (e) {
    console.error(e);
    document.body.textContent = 'Stratus could not start: ' + e.message;
  }
})();
