# Research Assistant

> **A comprehensive AI research assistant with access to patent search, academic literature, clinical trials, and document processing** - Search across multiple authoritative data sources through natural language. Powered by Valyu's unified search API.

🚀 **[Try the live demo](https://research.valyu.network)**

![Research Assistant](public/valyu.png)

## Why Research Assistant?

Research is fragmented across dozens of databases and platforms. This assistant changes everything by providing:

- **🔍 Unified Search** - Access patent databases, academic literature, clinical trials, and document processing through one interface
- **📊 Data Visualization** - Create interactive charts and visualizations for your research findings
- **🐍 Code Execution** - Run Python code in secure Daytona sandboxes for data analysis and modeling
- **📄 Document Processing** - Extract text from PDFs, DOCX files, and other documents
- **🔬 Patent Intelligence** - Patent search integration for intellectual property and innovation tracking
- **🏠 Local AI Models** - Run with Ollama for unlimited, private queries using your own hardware
- **🎯 Natural Language** - Just ask questions like you would to a colleague

## Key Features

### 🔥 Comprehensive Research Tools

- **Patent Search** - Search patent databases for intellectual property, technical disclosures, and innovation tracking
- **Research Search** - Search academic databases including PubMed, ArXiv, and Wiley journals for scientific papers and biomedical research
- **Clinical Trials** - Search and get detailed information about clinical trials from ClinicalTrials.gov
- **Clinical Trial Details** - Get comprehensive details about specific clinical trials using NCT IDs

### 🛠️ Advanced Analysis Tools

- **Python Code Execution** - Run Python code securely in Daytona sandboxes for data analysis and modeling
- **Interactive Charts** - Create line, bar, and area charts with time series support
- **Document Processing** - Extract text from PDFs, DOCX files, and plain text files
- **Multi-Source Research** - Automatically aggregates data from multiple sources
- **Patent Intelligence** - Access patent databases for intellectual property analysis

## 🚀 Quick Start

### Prerequisites

**For Cloud Usage:**

- Node.js 18+
- npm or yarn
- OpenAI API key
- Valyu API key (get one at [platform.valyu.network](https://platform.valyu.network))
- Daytona API key (for code execution)

**For Local AI Models:**

- All of the above, plus:
- [Ollama](https://ollama.com) installed and running
- At least one model installed (qwen2.5:7b recommended)

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/yorkeccak/bio.git
   cd bio
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Set up environment variables**

   Create a `.env.local` file in the root directory:

   ```env
   # OpenAI Configuration
   OPENAI_API_KEY=your-openai-api-key

   # Valyu API Configuration
   VALYU_API_KEY=your-valyu-api-key

   # Daytona Configuration (for Python execution)
   DAYTONA_API_KEY=your-daytona-api-key
   DAYTONA_API_URL=https://api.daytona.io  # Optional
   DAYTONA_TARGET=latest  # Optional

   # App Configuration
   NEXT_PUBLIC_APP_URL=http://localhost:3000  # Your deployment URL in production

   # Ollama Configuration (Optional - for local models)
   # By default, Ollama support is DISABLED for production mode
   # To enable Ollama support, uncomment the line below:
   # APP_MODE=development  # Enable local model support
   OLLAMA_BASE_URL=http://localhost:11434  # Default Ollama URL
   ```

4. **Run the development server**

   ```bash
   npm run dev
   ```

5. **Check your configuration (optional)**

   ```bash
   npm run check-config
   ```

   This will show you whether Ollama support is enabled or disabled.

6. **Open your browser**

   Navigate to [http://localhost:3000](http://localhost:3000)

### 🏠 Local Model Setup (Optional)

**Note**: By default, Ollama support is **disabled** for production mode. The app will use OpenAI/Vercel AI Gateway with rate limiting (5 queries/day).

For unlimited, private queries using your own hardware:

1. **Install Ollama**

   ```bash
   # macOS
   brew install ollama

   # Or download from https://ollama.com
   ```

2. **Start Ollama service**

   ```bash
   ollama serve
   ```

3. **Install recommended models**

   ```bash
   # Best for tool calling (recommended)
   ollama pull qwen2.5:7b

   # Alternative options
   ollama pull qwen2.5:14b    # Better but slower
   ollama pull llama3.1:7b    # Good general performance
   ```

4. **Switch to local model**

   Click the "Local Models" indicator in the top-right corner of the app to select your model.

**Model Recommendations:**

- **Qwen2.5:7B+** - Excellent for tool calling and biomedical analysis
- **Llama 3.1:7B+** - Good general performance with tools
- **Avoid smaller models** - Many struggle with complex function calling

## 💡 Example Queries

Try these powerful queries to see what the Research Assistant can do:

- "Search for patents related to CRISPR gene editing technology and their applications"
- "What's the latest evidence on reversing aging with gene therapy from arXiv papers?"
- "Find patents on brain-computer interfaces and their clinical applications"
- "Search for clinical trials on CRISPR gene therapy and their current status"
- "What are the current trends in immunotherapy for cancer treatment?"
- "Search for recent studies on Alzheimer's disease biomarkers and early detection"
- "Find clinical trials investigating new treatments for Parkinson's disease"
- "What's the latest research on stem cell therapy for spinal cord injuries?"

**With Local Models (Ollama):**

- Run unlimited queries without API costs
- Keep all your research completely private
- Perfect for sensitive data and proprietary research

## 🏗️ Architecture

- **Frontend**: Next.js 15 with App Router, Tailwind CSS, shadcn/ui
- **AI**: OpenAI GPT-4 with function calling + Ollama for local models
- **Data**: Valyu API for comprehensive research data (patent search, academic literature, clinical trials, document processing)
- **Code Execution**: Daytona sandboxes for secure Python execution
- **Visualizations**: Recharts for interactive charts
- **Document Processing**: PDF parsing, DOCX extraction, and text file reading
- **Real-time**: Streaming responses with Vercel AI SDK
- **Local Models**: Ollama integration for private, unlimited queries

## 🔒 Security

- Secure API key management
- Sandboxed code execution via Daytona
- No storage of sensitive research data
- HTTPS encryption for all API calls
- Secure document processing and file handling

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 🙏 Acknowledgments

- Built with [Valyu](https://platform.valyu.network) - The unified research data API
- Powered by [Daytona](https://daytona.io) - Secure code execution
- UI components from [shadcn/ui](https://ui.shadcn.com)

---

<p align="center">
  Made with ❤️ by the Valyu team
</p>

<p align="center">
  <a href="https://twitter.com/ValyuNetwork">Twitter</a> •
  <a href="https://www.linkedin.com/company/valyu-network">LinkedIn</a> •
  <a href="https://github.com/yorkeccak/bio">GitHub</a>
</p>
