export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key.includes("=")) {
      const [name, ...rest] = key.split("=");
      setArg(out, name, rest.join("="));
    } else {
      const next = argv[i + 1];
      setArg(out, key, !next || next.startsWith("--") ? true : argv[++i]);
    }
  }
  return out;
}

function setArg(out, key, value) {
  if (out[key] === undefined) out[key] = value;
  else if (Array.isArray(out[key])) out[key].push(value);
  else out[key] = [out[key], value];
}
