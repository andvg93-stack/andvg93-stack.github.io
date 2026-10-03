'use client';

import { BookOpen, ExternalLink, Info, Sigma } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { ModelManifest } from '@/lib/simulation/types';

export function MethodSheet({ manifest }: { manifest: ModelManifest }) {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" className="method-trigger" /> }>
        <Info aria-hidden="true" />
        Fuentes y método
      </SheetTrigger>
      <SheetContent className="method-sheet" side="right">
        <SheetHeader className="method-sheet__header">
          <span className="panel-kicker"><BookOpen aria-hidden="true" /> Transparencia del modelo</span>
          <SheetTitle>Cómo leer Café 2035</SheetTitle>
          <SheetDescription>
            El simulador combina datos oficiales, cartografía libre y reglas explícitas para construir un escenario didáctico reproducible.
          </SheetDescription>
        </SheetHeader>

        <div className="method-sheet__content">
          <section>
            <h3><Sigma aria-hidden="true" /> Qué calcula</h3>
            <p>
              La huella inicial distribuye las hectáreas EVA 2026 dentro de cada municipio. La aptitud combina clima, cobertura compatible, presión de transformación y continuidad espacial; RUNAP y agua se tratan como exclusiones o señales de presión.
            </p>
            <div className="formula-card">
              <span>Puntuación territorial</span>
              <code>40% aptitud + 25% clima + 15% cobertura + 10% presión + 10% continuidad</code>
            </div>
            <p>
              Las incorporaciones y los retiros parciales se distribuyen durante varios años. La superficie siempre cumple: área inicial + expansión − retiro. El escenario usa una señal climática didáctica hasta 2035; las fechas mensuales son estimadas.
            </p>
          </section>

          <section>
            <h3>Fuentes versionadas</h3>
            <div className="source-list">
              {manifest.sources.map((source) => (
                <a key={source.name} href={source.url} target="_blank" rel="noreferrer">
                  <span>
                    <strong>{source.name}</strong>
                    <small>{source.use}</small>
                  </span>
                  <ExternalLink aria-hidden="true" />
                </a>
              ))}
            </div>
          </section>

          <section>
            <h3>Limitaciones que debes contar</h3>
            <ul>
              {manifest.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </section>

          <section className="model-audit">
            <h3>Comprobaciones</h3>
            <dl>
              {Object.entries(manifest.checks).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>
            <p>Modelo {manifest.version} · generado {new Date(manifest.generatedAt).toLocaleDateString('es-CO')}</p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
