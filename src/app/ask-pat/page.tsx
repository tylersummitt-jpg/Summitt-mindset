// src/app/ask-pat/page.tsx
export default function AskPatPage() {
  return (
    <main className="bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-12 space-y-4">
        <h1 className="text-3xl font-bold mb-2">Ask Pat AI</h1>
        <p className="text-gray-700 text-sm mb-4">
          This will be your coaching space. You&apos;ll be able to ask questions
          about discipline, team, adversity, and more, and get guidance modeled
          on Pat Summitt&apos;s principles.
        </p>
        <div className="bg-white border rounded p-4 text-sm text-gray-600">
          <p className="mb-2 font-semibold">Chat interface placeholder</p>
          <p>
            We&apos;ll add a real chat box here later, wired to the Ask Pat AI
            backend that uses your Summitt Assessment profile and Pat&apos;s
            content.
          </p>
        </div>
      </div>
    </main>
  );
}
