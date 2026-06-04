import { schemaArtifacts, writeGeneratedArtifact } from "./generated-artifacts.mjs";

for (const artifact of schemaArtifacts) {
  await writeGeneratedArtifact(artifact);
}
