export interface CliIO {
  stderr: NodeJS.WritableStream;
  stdout: NodeJS.WritableStream;
}

export interface GlobalOptions {
  config?: string;
  cwd?: string;
}
