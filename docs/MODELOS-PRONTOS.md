# Biblioteca de modelos prontos (Estúdio)

Modelos editáveis que a agência adiciona aos próprios templates com um clique
(Estúdio → Templates → **Biblioteca de modelos** → **Adicionar à agência**).

## Quem vê

- A conta administradora da plataforma (`ARAGONEZ_ADMIN`).
- Sem `ARAGONEZ_ADMIN` configurada: a proprietária da agência.
- Em ambos os casos é preciso poder gerenciar templates, criar artes e enviar
  arquivos. Quem não atende a isso não vê a seção, e o servidor recusa a ação.

## O que acontece ao adicionar

1. As imagens de exemplo de cada modelo são geradas no servidor (sharp) e salvas
   em **Arquivos** da agência (categoria "modelo", etiquetas `modelo` e
   `biblioteca`).
2. O documento (formato 2) é montado com essas imagens e gravado como
   **template** da agência, com `meta.library = { key, version }` e a miniatura
   embutida.
3. O mesmo modelo não é adicionado duas vezes. Para ter outra cópia, use
   **Duplicar** no template.

Depois disso o modelo é um template comum: "Usar template", "Trocar imagem",
editar textos, cores e camadas, aprovar e exportar.

## Conteúdo dos modelos

Os modelos recriam o layout, a hierarquia de texto e as cores de referências
enviadas pela agência. Nomes, perfis, logos, marcas e fotos de terceiros nunca
são copiados: textos, @, assinatura e imagens são de exemplo, para trocar.

| Chave | Modelo | Páginas |
| --- | --- | --- |
| `capa-impacto` | Capa de impacto (foto, selo do perfil, título condensado com destaque) | 1 |
| `minimal-escuro` | Minimal escuro (peso fino + negrito, caixa de apoio, "Leia a legenda") | 1 |
| `foto-neon` | Foto escura com neon (serviços em pílulas, linha marcada, botão de contato) | 1 |
| `carrossel-editorial-claro` | Carrossel editorial claro (capa, ideia, desenvolvimento, exemplo, final) | 5 |

## Como criar um modelo novo

- Arquivo em `src/lib/template-library/` usando as peças de `kit.ts`. `text()`
  posiciona pela **linha de base** e calcula a altura como o editor mede
  (Fabric: 1,13 × tamanho por linha). Use `lineHeightFor(tamanho, distância)`
  para a distância entre linhas.
- Trechos lado a lado com estilos diferentes (ex.: fino + negrito na mesma linha)
  são caixas separadas. A posição vem da largura medida com a fonte real, e o
  comentário no código registra o valor.
- Prefira fontes do Google Fonts. O editor carrega os pesos usados (inclusive
  fino, 100–300) antes de desenhar.
- Declare as imagens de exemplo em `placeholders` (tipo e tamanho) e registre o
  modelo em `index.ts`. Ao mudar um modelo publicado, suba `version`.
- Gere a miniatura (1ª página desenhada pelo editor, 320 × 400, JPEG) em
  `thumbnails.ts`.
- Testes: `tests/template-library.test.ts` confere que todo modelo é válido,
  fica dentro da página e usa todas as imagens de exemplo.
