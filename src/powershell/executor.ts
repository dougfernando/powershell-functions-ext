import { execFile } from "node:child_process"

export interface ExecutionResult {
    stdout: string
    stderr: string
}

function quotePowerShellLiteral(value: string): string {
    return "'" + value.replace(/'/g, "''") + "'"
}

export function executePowerShellFunction(
    functionName: string,
    scriptPath: string,
    options: { signal: AbortSignal; timeout: number },
): Promise<ExecutionResult> {
    const script = [
        "$ErrorActionPreference = 'Stop'",
        ". " + quotePowerShellLiteral(scriptPath),
        "& " + quotePowerShellLiteral(functionName),
    ].join("; ")

    return new Promise((resolve, reject) => {
        execFile(
            "pwsh.exe",
            ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
            {
                encoding: "utf8",
                maxBuffer: 10 * 1024 * 1024,
                signal: options.signal,
                timeout: options.timeout,
                windowsHide: true,
            },
            (error, stdout, stderr) => {
                if (error) {
                    const executionError = new Error(stderr.trim() || error.message)
                    executionError.name = error.name
                    reject(executionError)
                    return
                }
                resolve({ stdout, stderr })
            },
        )
    })
}
