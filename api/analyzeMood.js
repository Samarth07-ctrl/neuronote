// api/analyzeMood.js
export default async function handler(req, res) {
  // 1. Method Check
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 2. Input Validation
  const { text } = req.body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'No text provided or invalid format' });
  }

  // 3. Environment Check
  if (!process.env.HF_API_KEY) {
    console.error("Missing HF_API_KEY in environment variables");
    return res.status(500).json({ error: "Server configuration error" });
  }

  // 4. API Configuration
  // Using the Friends-tuned model (DistilRoBERTa)
  const MODEL_ID = "michellejieli/emotion_text_classifier";
  const API_URL = `https://api-inference.huggingface.co/models/${MODEL_ID}`;

  try {
    const response = await fetch(API_URL, {
      headers: {
        "Authorization": `Bearer ${process.env.HF_API_KEY}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      body: JSON.stringify({ inputs: text }),
    });

    // 5. Handle Non-JSON Responses (Prevents SyntaxError crashes)
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      const textBody = await response.text();
      console.error("HF API returned non-JSON:", textBody);
      return res.status(500).json({ error: "AI Service returned an unexpected format." });
    }

    const result = await response.json();

    // 6. Handle Hugging Face Specific Errors
    // The Free Tier often sends a "Model Loading" 503 error
    if (result.error && result.error.includes("loading")) {
      return res.status(503).json({ 
        error: "Model is waking up",
        estimated_time: result.estimated_time || 20,
        isLoading: true 
      });
    }

    // 7. Success
    return res.status(200).json(result);

  } catch (error) {
    console.error("Critical HF API Error:", error);
    return res.status(500).json({ error: "Failed to connect to AI service" });
  }
}