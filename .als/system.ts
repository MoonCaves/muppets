import { defineSystem } from "./authoring.ts";

export const system = defineSystem({
  "als_version": 1,
  "system_id": "kyberbot",
  "modules": {
    "kyberbot-factory": {
      "path": "kyberbot-factory/jobs",
      "version": 1,
      "description": "factory for kyberbot",
      "skills": [
        "kyberbot-factory-console",
        "kyberbot-factory-inspect"
      ]
    }
  }
} as const);

export default system;
