const path = require('path');

const extensionConfig = {
    target: 'node',
    mode: 'none',
    entry: './src/extension.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'extension.js',
        libraryTarget: 'commonjs2'
    },
    externals: {
        vscode: 'commonjs vscode'
    },
    resolve: {
        extensions: ['.ts', '.js']
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [
                    {
                        // esbuild strips types ~3× faster than ts-loader (it's native Go).
                        // It does NOT type-check — that's the separate `tsc --noEmit` gate's
                        // job — and the codebase is `isolatedModules`-clean, so per-file
                        // transpilation is safe. terser still minifies in production
                        // (we don't register EsbuildPlugin as the minimizer), which keeps
                        // the bundle smaller than esbuild's own minifier.
                        loader: 'esbuild-loader',
                        options: { loader: 'ts', target: 'es2022' }
                    }
                ]
            }
        ]
    },
    devtool: 'nosources-source-map',
    infrastructureLogging: {
        level: "log",
    },
};

const cliConfig = {
    target: 'node',
    mode: 'none',
    entry: './src/cli.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'cli.js',
        libraryTarget: 'commonjs2'
    },
    resolve: {
        extensions: ['.ts', '.js']
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [
                    {
                        // esbuild strips types ~3× faster than ts-loader (it's native Go).
                        // It does NOT type-check — that's the separate `tsc --noEmit` gate's
                        // job — and the codebase is `isolatedModules`-clean, so per-file
                        // transpilation is safe. terser still minifies in production
                        // (we don't register EsbuildPlugin as the minimizer), which keeps
                        // the bundle smaller than esbuild's own minifier.
                        loader: 'esbuild-loader',
                        options: { loader: 'ts', target: 'es2022' }
                    }
                ]
            }
        ]
    },
    devtool: 'nosources-source-map',
    infrastructureLogging: {
        level: "log",
    },
};

const serverConfig = {
    target: 'node',
    mode: 'none',
    entry: './src/server.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'server.js',
        libraryTarget: 'commonjs2'
    },
    resolve: {
        extensions: ['.ts', '.js']
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [
                    {
                        // esbuild strips types ~3× faster than ts-loader (it's native Go).
                        // It does NOT type-check — that's the separate `tsc --noEmit` gate's
                        // job — and the codebase is `isolatedModules`-clean, so per-file
                        // transpilation is safe. terser still minifies in production
                        // (we don't register EsbuildPlugin as the minimizer), which keeps
                        // the bundle smaller than esbuild's own minifier.
                        loader: 'esbuild-loader',
                        options: { loader: 'ts', target: 'es2022' }
                    }
                ]
            }
        ]
    },
    devtool: 'nosources-source-map',
    infrastructureLogging: {
        level: "log",
    },
};

module.exports = [extensionConfig, serverConfig, cliConfig];