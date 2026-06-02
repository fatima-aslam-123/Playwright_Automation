import { exec } from "child_process";

export async function runCompaniesTests() {
  return new Promise((resolve, reject) => {

    exec(
      "npx playwright test tests/companies.spec.js",
      (error, stdout, stderr) => {

        if (error) {
          reject(stderr);
          return;
        }

        resolve(stdout);
      }
    );

  });
}
