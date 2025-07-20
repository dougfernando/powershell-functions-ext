import { Action, ActionPanel, Cache, getPreferenceValues, Icon, List, showToast, Toast } from "@raycast/api";
import { exec } from "child_process";
import { promisify } from "util";
import { homedir } from "os";
import { existsSync, realpathSync } from "fs";
import { readFile } from "fs/promises";
import { useEffect, useState } from "react";

const execAsync = promisify(exec);
const cache = new Cache();
const FUNCTIONS_CACHE_KEY = "powershell-functions";

interface Preferences {
    scriptPath: string;
}

function escapePowerShellPath(path: string): string {
    return path.replace(/'/g, "''").replace(/\\/g, "\\\\");
}

async function executePowerShellFunction(functionName: string, scriptPath: string) {
    const toast = await showToast({
        style: Toast.Style.Animated,
        title: `Executing "${functionName}"...`,
    });

    try {
        const expandedPath = scriptPath.replace(/^~/, homedir());
        if (!existsSync(expandedPath)) {
            throw new Error(`File not found at: ${expandedPath}`);
        }
        const realPath = realpathSync(expandedPath);
        const escapedPath = escapePowerShellPath(realPath);
        const command = `. '${escapedPath}'; ${functionName}`;

        const { stdout, stderr } = await execAsync(`pwsh.exe -NoProfile -ExecutionPolicy Bypass -Command "${command}"`);

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
    const [functions, setFunctions] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string>();

    useEffect(() => {
        // Load from cache immediately on mount
        const cachedFunctions = cache.get(FUNCTIONS_CACHE_KEY);
        if (cachedFunctions) {
            setFunctions(JSON.parse(cachedFunctions));
        }
        setIsLoading(false);
    }, []);

    const handleReload = async () => {
        setIsLoading(true);
        setError(undefined);
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
            const content = await readFile(realPath, "utf-8");
            const regex = /^function\s+([a-zA-Z0-9_-]+)\s*(?:\(\s*\))?\s*\{/gm;
            const foundFunctions: string[] = [];
            let match;
            while ((match = regex.exec(content)) !== null) {
                foundFunctions.push(match[1]);
            }

            setFunctions(foundFunctions);
            cache.set(FUNCTIONS_CACHE_KEY, JSON.stringify(foundFunctions));
            await showToast({
                style: Toast.Style.Success,
                title: "Functions Reloaded",
                message: `Found ${foundFunctions.length} parameter-less functions.`,
            });
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : "An unknown error occurred.";
            setError(errorMessage);
            await showToast({
                style: Toast.Style.Failure,
                title: "Error Reloading Functions",
                message: errorMessage,
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <List isLoading={isLoading} searchBarPlaceholder="Filter functions...">
            {error ? (
                <List.EmptyView
                    title="Error"
                    description={error}
                    icon={Icon.XMarkCircle}
                    actions={
                        <ActionPanel>
                            <Action title="Reload Functions" icon={Icon.Repeat} onAction={handleReload} />
                        </ActionPanel>
                    }
                />
            ) : functions.length > 0 ? (
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
                                    onAction={() => executePowerShellFunction(funcName, preferences.scriptPath)}
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
                    title={isLoading ? "Loading..." : "No Cached Functions Found"}
                    description={
                        isLoading
                            ? "Please wait..."
                            : "Press Cmd+R to load functions from your PowerShell script."
                    }
                    icon={Icon.Cog}
                    actions={
                        <ActionPanel>
                            <Action title="Reload Functions" icon={Icon.Repeat} onAction={handleReload} />
                        </ActionPanel>
                    }
                />
            )}
        </List>
    );
}