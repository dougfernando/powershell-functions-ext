import { Action, ActionPanel, getPreferenceValues, Icon, List, showToast, Toast } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { exec } from "child_process";
import { promisify } from "util";
import { homedir } from "os";
import { existsSync, realpathSync } from "fs";
import { useEffect, useState } from "react";

const execAsync = promisify(exec);

interface Preferences {
    scriptPath: string;
}
function escapePowerShellPath(path: string): string {
    return path
        .replace(/'/g, "''") // Escape single quotes
        .replace(/\\/g, '\\\\'); // Escape backslashes
}

async function fetchFunctionsFromScript(filePath: string): Promise<string[]> {
    try {
        const escapedPath = escapePowerShellPath(filePath);

        // Method 1: Try AST parsing first (most accurate)
        try {
            const astCommand = `
                $ErrorActionPreference = 'Stop';
                $ast = [System.Management.Automation.Language.Parser]::ParseFile(
                    '${escapedPath}', 
                    [ref]$null, 
                    [ref]$null
                );
                $functions = $ast.FindAll({ 
                    param($node) 
                    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and 
                    $node.Parameters.Count -eq 0 
                }, $true);
                if ($functions) { $functions.Name | ConvertTo-Json -Compress }
            `.replace(/\n\s+/g, ' ').trim();

            const { stdout: astStdout } = await execAsync(
                `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${astCommand}"`
            );

            if (astStdout.trim()) {
                return JSON.parse(astStdout);
            }
        } catch (astError) {
            console.log('AST parsing failed, falling back to regex method:', astError);
        }

        // Method 2: Fallback to regex if AST fails
        const regexCommand = `
            $ErrorActionPreference = 'Stop';
            $content = Get-Content -Path '${escapedPath}' -Raw;
            $matches = [regex]::Matches(
                $content, 
                'function\\s+([^\\s{]+)\\s*\\{(?:[^{}]*|\\{(?:[^{}]*|\\{[^{}]*\\})*\\})*\\}'
            );
            if ($matches.Success) {
                $matches.Groups[1].Value | Select-Object -Unique | ConvertTo-Json -Compress
            }
        `.replace(/\n\s+/g, ' ').trim();

        const { stdout: regexStdout } = await execAsync(
            `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${regexCommand}"`
        );

        return regexStdout.trim() ? JSON.parse(regexStdout) : [];
    } catch (error) {
        console.error('Both methods failed to parse script:', error);
        throw new Error(`Failed to parse PowerShell script: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Executes a PowerShell function
 */
async function executePowerShellFunction(functionName: string, scriptPath: string) {
    const toast = await showToast({
        style: Toast.Style.Animated,
        title: `Executing "${functionName}"...`,
    });

    try {
        const escapedPath = escapePowerShellPath(scriptPath);
        const command = `. '${escapedPath}'; ${functionName}`;

        const { stdout, stderr } = await execAsync(
            `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${command}"`
        );

        if (stderr) {
            throw new Error(stderr);
        }

        toast.style = Toast.Style.Success;
        toast.title = `Executed "${functionName}" Successfully`;
        toast.message = stdout.trim() ? `Output: ${stdout.trim()}` : undefined;
    } catch (error) {
        toast.style = Toast.Style.Failure;
        toast.title = `Failed to Execute "${functionName}"`;
        toast.message = error instanceof Error ? error.message : "An unknown error occurred";
        console.log(toast.message)
    }
}

export default function Command() {
    const preferences = getPreferenceValues<Preferences>();
    const [resolvedPath, setResolvedPath] = useState<string>();
    const [pathError, setPathError] = useState<string>();

    useEffect(() => {
        try {
            const initialPath = preferences.scriptPath;
            if (!initialPath) {
                throw new Error("PowerShell Script Path preference is not set.");
            }

            const expandedPath = initialPath.replace(/^~/, homedir());

            if (!existsSync(expandedPath)) {
                throw new Error(`File not found at: ${expandedPath}`);
            }

            const realPath = realpathSync(expandedPath);
            setResolvedPath(realPath);
            setPathError(undefined);
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : "An unknown error occurred while resolving the path.";
            setPathError(errorMessage);
            setResolvedPath(undefined);
            console.error('Path resolution error:', e);
        }
    }, [preferences.scriptPath]);

    const {
        data: functions,
        isLoading,
        error,
        revalidate,
    } = usePromise(
        async (path: string | undefined) => {
            if (!path) return [];
            return await fetchFunctionsFromScript(path);
        },
        [resolvedPath]
    );

    if (pathError) {
        return (
            <List>
                <List.EmptyView
                    title="Invalid Path"
                    description={pathError}
                    icon={Icon.XMarkCircle}
                    actions={
                        <ActionPanel>
                            <Action
                                title="Reload"
                                icon={Icon.Repeat}
                                onAction={() => {
                                    setPathError(undefined);
                                    setResolvedPath(undefined);
                                }}
                            />
                        </ActionPanel>
                    }
                />
            </List>
        );
    }

    const fetchError = error ? `Failed to read functions: ${error.message}` : undefined;

    return (
        <List isLoading={isLoading && !error && !pathError} searchBarPlaceholder="Filter functions...">
            {functions && functions.length > 0 ? (
                functions.map((funcName) => (
                    <List.Item
                        key={funcName}
                        title={funcName}
                        icon={Icon.Cog}
                        actions={
                            <ActionPanel>
                                <Action
                                    title="Execute Function"
                                    icon={Icon.Play}
                                    onAction={() => executePowerShellFunction(funcName, resolvedPath!)}
                                />
                                <Action
                                    title="Reload Functions"
                                    icon={Icon.Repeat}
                                    onAction={revalidate}
                                    shortcut={{ modifiers: ["cmd"], key: "r" }}
                                />
                            </ActionPanel>
                        }
                    />
                ))
            ) : (
                <List.EmptyView
                    title={isLoading ? "Loading Functions..." : "No Parameter-less Functions Found"}
                    description={
                        fetchError ||
                        (isLoading
                            ? "Reading your script..."
                            : `Ensure the file at "${resolvedPath}" contains functions without arguments.`)
                    }
                    icon={Icon.Cog}
                    actions={
                        <ActionPanel>
                            <Action
                                title="Reload Functions"
                                icon={Icon.Repeat}
                                onAction={revalidate}
                            />
                        </ActionPanel>
                    }
                />
            )}
        </List>
    );
}