import { defineConfig } from 'vite'
import Userscript from 'vite-plugin-tm-userscript'

export default defineConfig({
    plugins: [
        Userscript({
            entry: 'src/main.js',
            headers: {
                name: 'biowel-voice-assistant',
                namespace: 'http://tampermonkey.net/',
                version: '2.0.0',
                description: 'Voice assistant for Biowel EHR',
                author: 'Diego Arbeláez',
                match: ['https://*.biowel.com/*'], // Ajusta esto según sea necesario
                grant: ['none'],
            }
        })
    ],
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    }
})
