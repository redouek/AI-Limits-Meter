const cfg = { currency: 'both', usdToBrl: 0, barColor: '#F5C518', language: 'pt-br' };
module.exports = {
  workspace: { getConfiguration: () => ({ get: (k, d) => (k in cfg ? cfg[k] : d) }) },
  env: { language: 'pt-br' },
  __cfg: cfg,
};
