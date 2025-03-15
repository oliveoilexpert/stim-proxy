import { terser } from "rollup-plugin-terser"
import copy from 'rollup-plugin-copy'

export default [
    {
        input: "src/index.js",
        output: [
            {
                name: "stim-proxy",
                file: "dist/stim-proxy.umd.js",
                format: "umd",
            },
            {
                file: "dist/stim-proxy.js",
                format: "es",
            },
        ],
        context: "window",
        // plugins: [
        //     copy({
        //         targets: [
        //             { src: 'src/index.d.ts', dest: 'dist/', rename: 'stim-proxy.d.ts' },
        //         ]
        //     })
        // ]
    },
    {
        input: "src/index.js",
        output: {
            file: "dist/stim-proxy.min.js",
            format: "es",
            sourcemap: true
        },
        context: "window",
        plugins: [
            terser({
                mangle: true,
                compress: true
            })
        ]
    }
]