import { spawn } from "node:child_process";

await run("npm run build:demo");

const wrangler = spawn(
  "npx wrangler dev --ip 127.0.0.1 --port 8787 --tunnel",
  {
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let outputBuffer = "";
let seedStarted = false;

wrangler.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  outputBuffer = `${outputBuffer}${text}`.slice(-4000);

  const match = outputBuffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (!seedStarted && match?.[0]) {
    seedStarted = true;
    void seedPublicOrigin(match[0]);
  }
});

wrangler.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

wrangler.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    wrangler.kill(signal);
  });
}

function run(commandLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandLine, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${commandLine} exited with code ${code}`));
    });
  });
}

async function seedPublicOrigin(origin) {
  for (let attempt = 1; attempt <= 45; attempt += 1) {
    try {
      const response = await fetch(`${origin}/`);
      if (response.ok) {
        console.log(`Seeded public invite origin: ${origin}`);
        console.log(`Open local dev: http://127.0.0.1:8787/`);
        console.log(`Public tunnel: ${origin}`);
        return;
      }
    } catch {
      // The tunnel can be printed before it is fully routable.
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.warn(`Could not seed public invite origin for ${origin}. Open the public tunnel once, then host locally.`);
}
