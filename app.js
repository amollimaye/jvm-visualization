(() => {
  const { initController, runScenario } = window.JVMSim;
  initController();
  window.runScenario = runScenario;
})();
