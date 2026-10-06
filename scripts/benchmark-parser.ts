import { performance } from "node:perf_hooks"
import { parsePowerShellFunctions } from "../src/powershell/parser.ts"

const functionCount = 10_000
const source = Array.from(
    { length: functionCount },
    (_, index) => '# @raycast.icon Icon.Cog\nfunction Test-Function-' + index + ' { "' + index + '" }',
).join("\n")

const durations: number[] = []
let functions = parsePowerShellFunctions(source)
for (let iteration = 0; iteration < 5; iteration++) {
    const startedAt = performance.now()
    functions = parsePowerShellFunctions(source)
    durations.push(performance.now() - startedAt)
}
durations.sort((left, right) => left - right)
const elapsed = durations[Math.floor(durations.length / 2)]
const budget = 150

if (functions.length !== functionCount) {
    throw new Error("Expected " + functionCount + " functions, found " + functions.length)
}

if (elapsed > budget) {
    throw new Error("Parser median exceeded the " + budget + " ms performance budget: " + elapsed.toFixed(2) + " ms")
}

console.log(
    "Parsed " +
        functionCount +
        " functions (" +
        (source.length / 1024 / 1024).toFixed(2) +
        " MiB) in a median of " +
        elapsed.toFixed(2) +
        " ms",
)
