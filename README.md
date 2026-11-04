# Ironmind

App de treino com Liga, desafios, feed e clube, instalável no celular (PWA).

- `public/`: o app. É esta pasta que vai para o ar.
- `supabase.sql`: banco de dados e regras de acesso (rodar uma vez no Supabase).
- `LEIA-ME.md`: passo a passo para colocar no ar.
- `claude-ai/ironmind.html`: cópia da versão que roda no claude.ai, com o coach de IA.

## Publicar pela Netlify ligada a este repositório

1. Preencha `public/config.js` com a Project URL e a anon key do Supabase (dá para editar direto no GitHub, no ícone de lápis).
2. Na Netlify: **Add new site > Import an existing project > GitHub** e escolha este repositório. O `netlify.toml` já diz para publicar a pasta `public`.
3. Cada mudança enviada para o repositório atualiza o site sozinha.
