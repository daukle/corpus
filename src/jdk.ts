import { readFileSync } from "node:fs";

/**
 * The JDKs the image offers, in the order a build tries them, from CORPUS_JDKS
 * ("17=/usr/lib/jvm/...,21=..."). Empty outside the image, where the build takes the host's JDK.
 */
export function availableJdks(): { version: string; home: string }[] {
  const text = process.env.CORPUS_JDKS ?? "";
  return text.split(",").filter((pair) => pair.includes("=")).map((pair) => {
    const [version, home] = pair.split("=");
    return { version, home };
  });
}

/**
 * Failures that name the Java version itself. Only these move a build to the next JDK, so a build
 * that is broken for another reason is not retried four times.
 */
const JDK_MISMATCH = [
  /release version \d+ not supported/,
  /invalid target release/,
  /Unsupported class file major version/,
  /class file has wrong version/,
  /Could not determine java version/,
  /package javax\.(xml\.bind|annotation|activation) does not exist/,
  /requires (Java|JDK) \d+/i,
  /Unsupported Java\b/,
  /source release \d+ requires target release/,
];

export function failedOnJdk(log: string): boolean {
  const text = readFileSync(log, "utf8");
  return JDK_MISMATCH.some((pattern) => pattern.test(text));
}
