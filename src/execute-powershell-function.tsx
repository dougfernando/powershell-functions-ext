import { Action, ActionPanel, getPreferenceValues, Icon, List, showToast, Toast, Cache } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { exec } from "child_process";
import { promisify } from "util";
import { homedir } from "os";
import { existsSync, realpathSync, statSync } from "fs";
import { useEffect, useState } from "react";

const execAsync = promisify(exec);
const cache = new Cache();

interface Preferences {
    scriptPath: string;
}

function escapePowerShellPath(path: string): string {
    return path
        .replace(/'/g, "''")
        .replace(/\\/g, '\\\\');
}

async function getFileKey(filePath: string): Promise<string> {
    const stats = statSync(filePath);
    return `functions-${filePath}-${stats.mtimeMs}`;
}

async function fetchFunctions(filePath: string, forceReload = false): Promise<string[]> {
    try {
        const cacheKey = await getFileKey(filePath);

        // Try to get from cache first
        if (!forceReload) {
            const cached = cache.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
        }

        console.log('[CACHE] Loading fresh functions');
        const escapedPath = escapePowerShellPath(filePath);

        const command = `
            $ErrorActionPreference = 'Stop';
            try {
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
            } catch {
                Write-Error "Error parsing script: $_";
                exit 1;
            }
        `.replace(/\n\s+/g, ' ').trim();

        const { stdout } = await execAsync(
            `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${command}"`
        );

        const functions = stdout.trim() ? JSON.parse(stdout) : [];

        // Store in cache (persists between command invocations)
        cache.set(cacheKey, JSON.stringify(functions));

        return functions;
    } catch (error) {
        console.error('Error fetching functions:', error);
        throw new Error(`Failed to parse PowerShell script: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function executePowerShellFunction(functionName: string, scriptPath: string) {
    const toast = await showToast({
        style: Toast.Style.Animated,
        title: `Executing "${functionName}"...`,
    });

    try {
        const escapedPath = escapePowerShellPath(scriptPath);
        const command = `. '${escapedPath}'; ${functionName}`;

        const { stdout, stderr } = await execAsync(
            `pwsh.exe -NoProfile -ExecutionPolicy Bypass -Command "${command}"`
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
        console.error(`Error executing function "${functionName}":`, error);
    }
}

export default function Command() {
    const preferences = getPreferenceValues<Preferences>();
    const [resolvedPath, setResolvedPath] = useState<string>();
    const [pathError, setPathError] = useState<string>();
    const [cacheBuster, setCacheBuster] = useState(0);

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
    } = usePromise(
        async (path: string | undefined, bust: number) => {
            if (!path) return [];
            return await fetchFunctions(path, bust > 0);
        },
        [resolvedPath, cacheBuster]
    );

    const handleReload = () => {
        console.log('[CACHE] Force reload requested');
        if (resolvedPath) {
            const cacheKey = getFileKey(resolvedPath);
            cache.remove(cacheKey); // Clear the cache
        }
        setCacheBuster(prev => prev + 1); // Force re-fetch
    };

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
                                    onAction={handleReload}
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
                                onAction={handleReload}
                            />
                        </ActionPanel>
                    }
                />
            )}
        </List>
    );
}
