import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  IDENTITY_POSTER_PROVISIONAL_TRIM,
  IDENTITY_POSTER_TEMPLATES,
  IdentityPosterUnsupportedCharacterError,
  layoutIdentityPoster,
  parseIdentityPosterTemplate,
  type IdentityPosterTemplateId,
} from "@/lib/keepsakes/identity-poster";
import { loadSignedInOwnerIdentity } from "@/lib/keepsakes/load-owner-identity";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const TEMPLATE_COPY: Record<IdentityPosterTemplateId, { name: string; note: string }> = {
  classic: { name: "Classic", note: "Centered serif on warm paper." },
  bold: { name: "Bold", note: "Large type on a dark field." },
  minimal: { name: "Minimal", note: "One block of type and open space." },
};

type PageProps = {
  searchParams?: Promise<{ template?: string }> | { template?: string };
};

async function readTemplate(searchParams: PageProps["searchParams"]): Promise<IdentityPosterTemplateId> {
  const params = !searchParams
    ? {}
    : searchParams instanceof Promise
      ? await searchParams
      : searchParams;
  return parseIdentityPosterTemplate(params.template) ?? "classic";
}

export default async function KeepsakeStudioPage({ searchParams }: PageProps) {
  const loaded = await loadSignedInOwnerIdentity();
  if (!loaded.ok) {
    if (loaded.status === 500) {
      return (
        <section className="rounded-lg border border-gray-200 bg-white px-5 py-6 text-sm text-gray-700">
          <p className="font-medium text-gray-900">Identity could not be loaded.</p>
          <p className="mt-2">Nothing was changed.</p>
        </section>
      );
    }
    notFound();
  }

  const template = await readTemplate(searchParams);
  const identity = loaded.identity;
  let unsupported = false;
  if (identity) {
    try {
      await layoutIdentityPoster({ identity, template });
    } catch (err) {
      if (err instanceof IdentityPosterUnsupportedCharacterError) unsupported = true;
      else throw err;
    }
  }

  const previewSrc = `/api/admin/keepsakes/identity-poster?template=${template}`;
  const downloadSrc = `${previewSrc}&download=1`;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-gray-900">Keepsake Studio</h1>
        <p className="text-sm text-gray-600">
          Identity Poster. {IDENTITY_POSTER_PROVISIONAL_TRIM.label}. The preview is the print file.
        </p>
      </header>

      {!identity ? (
        <section className="rounded-lg border border-gray-200 bg-white px-5 py-6 text-sm text-gray-700">
          <p className="font-medium text-gray-900">No Identity is saved on this account yet.</p>
          <p className="mt-2">
            This poster uses the Identity already stored for you. It does not write or replace one.
          </p>
        </section>
      ) : unsupported ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-6 text-sm text-amber-950">
          <p className="font-medium">This Identity includes a character the poster font cannot print.</p>
          <p className="mt-2">Nothing was changed.</p>
        </section>
      ) : (
        <>
          <nav className="grid gap-3 sm:grid-cols-3" aria-label="Poster templates">
            {IDENTITY_POSTER_TEMPLATES.map((id) => {
              const selected = id === template;
              const copy = TEMPLATE_COPY[id];
              return (
                <Link
                  key={id}
                  href={`/admin/keepsakes?template=${id}`}
                  aria-current={selected ? "page" : undefined}
                  className={`min-h-11 rounded-lg border px-4 py-3 ${
                    selected
                      ? "border-gray-900 bg-white text-gray-900"
                      : "border-gray-200 bg-white text-gray-600 hover:border-gray-400"
                  }`}
                >
                  <span className="block text-sm font-semibold">{copy.name}</span>
                  <span className="mt-1 block text-xs">{copy.note}</span>
                </Link>
              );
            })}
          </nav>

          <div className="mx-auto w-full max-w-sm">
            <div className="relative aspect-[3/4] overflow-hidden rounded-md border border-gray-300 bg-white shadow-sm">
              <object
                data={previewSrc}
                type="application/pdf"
                className="absolute inset-0 h-full w-full"
                aria-label="Identity poster preview"
              >
                <iframe title="Identity poster preview" src={previewSrc} className="absolute inset-0 h-full w-full" />
              </object>
            </div>
          </div>

          <p>
            <a
              href={downloadSrc}
              className="inline-flex min-h-11 items-center rounded-md bg-gray-900 px-4 text-sm font-medium text-white"
            >
              Download PDF
            </a>
          </p>

          <details className="text-sm text-gray-600">
            <summary className="cursor-pointer font-medium text-gray-800">Identity used in this poster</summary>
            <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-gray-900">{identity}</pre>
          </details>
        </>
      )}
    </div>
  );
}
