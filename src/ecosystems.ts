export type EcosystemName = "gradle" | "maven" | "npm" | "cmake";

export interface Ecosystem {
  name: EcosystemName;
  /** GitHub search languages whose repositories may build with this tool. */
  languages: string[];
  /** Any one of these at the repository root admits a repository to the pool. */
  rootFiles: string[];
}

export const ECOSYSTEMS: Ecosystem[] = [
  { name: "gradle", languages: ["java", "kotlin"], rootFiles: ["build.gradle", "build.gradle.kts"] },
  { name: "maven", languages: ["java"], rootFiles: ["pom.xml"] },
  { name: "npm", languages: ["javascript", "typescript"], rootFiles: ["package.json"] },
  { name: "cmake", languages: ["c", "c++"], rootFiles: ["CMakeLists.txt"] },
];

export function ecosystemNamed(name: string): Ecosystem {
  const found = ECOSYSTEMS.find((ecosystem) => ecosystem.name === name);
  if (found === undefined) throw new Error(`no ecosystem is called "${name}"`);
  return found;
}
