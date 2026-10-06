import assert from "node:assert/strict"
import test from "node:test"
import { parsePowerShellFunctions } from "../src/powershell/parser.ts"

test("finds parameterless functions and ignores functions with parameters", () => {
    const functions = parsePowerShellFunctions(
        [
            'function Get-Fast { "ok" }',
            "function With-InlineParameter(\$Name) { \$Name }",
            "function With-ParamBlock {",
            "    [CmdletBinding()]",
            "    param([string]\$Name)",
            "}",
            'function With-EmptyParamBlock { param() "ok" }',
        ].join("\n"),
    )
    assert.deepEqual(
        functions.map(func => func.name),
        ["Get-Fast", "With-EmptyParamBlock"],
    )
})

test("ignores declarations inside comments, strings, and here-strings", () => {
    const functions = parsePowerShellFunctions(
        [
            "# function Commented-Out { }",
            "<# function Block-Commented { } #>",
            '"function In-A-String { }"',
            "@'",
            "function In-A-HereString { }",
            "'@",
            "function Real-Function { }",
        ].join("\n"),
    )
    assert.deepEqual(functions.map(func => func.name), ["Real-Function"])
})

test("reads adjacent Raycast metadata", () => {
    const [func] = parsePowerShellFunctions(
        [
            "# @raycast.title Restart Development",
            "# @raycast.icon Icon.RotateClockwise",
            "# @raycast.description Restarts local services",
            "# @raycast.keywords docker, development",
            "# @raycast.confirm true",
            "# @raycast.timeout 120",
            "function Restart-Development { }",
        ].join("\n"),
    )
    assert.equal(func.title, "Restart Development")
    assert.equal(func.icon, "Icon.RotateClockwise")
    assert.equal(func.description, "Restarts local services")
    assert.deepEqual(func.keywords, ["docker", "development"])
    assert.equal(func.requiresConfirmation, true)
    assert.equal(func.timeout, 120_000)
})

test("supports scoped and case-insensitive declarations", () => {
    const functions = parsePowerShellFunctions("FUNCTION global:Start-Thing { }\nFunction script:Stop-Thing { }")
    assert.deepEqual(functions.map(func => func.name), ["Start-Thing", "Stop-Thing"])
})

test("requires a command boundary and does not cross malformed declarations", () => {
    const functions = parsePowerShellFunctions(
        [
            "Write-Output function False-Positive { }",
            "function Missing-Body",
            "function Valid-Function { }",
        ].join("\n"),
    )
    assert.deepEqual(functions.map(func => func.name), ["Valid-Function"])
})
