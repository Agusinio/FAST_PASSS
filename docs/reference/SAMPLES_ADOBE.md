# Mostres del SDK d'Adobe — fora del repo

Les 19 MB de mostres del SDK (PProPanel, `payloads`, `.NNP`, `.ZIP`, `.aaf`, snippets JSX)
que abans vivien a `docs/SAMPLES/` **han sortit del repositori** el 2026-09-30:
pesaven un 19 % del git i no les emprava cap codi (només les citaven els docs ja arxivats).

## On són ara

```
C:\temp\fp\docs_SAMPLES\
├── CODE\      (SDK oficial: PProPanel, payloads, snippets, jsx)
├── DATA\      (buida — la feien servir analyze-escaleta.ps1 i clean-escaleta.ps1 com a exemple)
└── nnews\     (fitxers de mostra del format NNEWS)
```

`bin/analyze-escaleta.ps1` i `bin/clean-escaleta.ps1` ja apunten al camí nou
(`C:\temp\fp\docs_SAMPLES\DATA\TN_VESPRE_20260429_213007.json`).

## Si cal tornar-les a tenir

- **Al disc:** ja hi són a `C:\temp\fp\docs_SAMPLES`. Si es perdés `C:\temp`, es poden
  rebaixar del SDK oficial d'Adobe (PProPanel / CEP Resources).
- **Al git:** són a l'historial (`git log --diff-filter=D --name-only -- docs/SAMPLES`).
- `.gitignore` bloqueja `docs/SAMPLES/` per si algú les torna a copiar a dins del repo.

> ⚠️ `C:\temp` no és un lloc definitiu: si es vol preservar, moure-ho a un recurs de xarxa
> i actualitzar aquesta nota + els dos scripts de `bin/` que hi apunten.
