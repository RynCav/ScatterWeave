# REU Madrigal Viewer

*Developed by Ryan Cavanaugh*

*[IMAGE PLACEHOLDER: Insert a high-resolution screenshot of the main dashboard or scatterplot view here to give users an immediate sense of the interface]*

The REU Madrigal Viewer is a comprehensive Python Flask application designed to extract, embed, cluster, and visualize academic papers. It utilizes local Large Language Models (LLMs) to perform advanced metadata extraction and provides interactive semantic search, mapping, and network visualizations of scientific literature.

## Core Features

### Advanced Visualizations & Views

The application provides several interactive views to explore semantic embeddings and paper relationships:

* **Scatterplot View**: Features a density heatmap, cluster islands, and a "Relevance Spiral" where points closer to the center are more similar to the selected point. It includes a GRU Tournament search model, semantic search visualization, Level of Detail (LOD) toggling, tooltip hover, and dropped pins showing the *k* closest points to an area.


* *[GIF PLACEHOLDER: Insert an animated GIF demonstrating zooming/panning in the Scatterplot, using the Lasso Marquee Select Tool, and toggling the Level of Detail (LOD)]*
* **Network View**: Node points scale dynamically based on up to 8 configurable connections per point. Features hover tooltips and allows users to multi-select the shortest path between points.


* *[GIF PLACEHOLDER: Insert an animated GIF showing a user hovering over nodes and highlighting shortest paths in the Network view]*
* **Hierarchy View**: Displays connected cards for each subcluster. Users can drag, rearrange, and merge clusters, utilizing split connections and an integrated network view.



### Dynamic Clustering & Plot Options

* **Clustering Models**: Perform K-means and HDBScan clustering on all points on the current plot. Retoggled points display as noise.


* **Advanced Grouping**: Subcluster points, cluster metadata independently (including keywords and summaries), and execute bias clustering.


* **Visual Enhancements**: Displays color gradients based on a point's distance to cluster centroids. Includes toggles for borders, grids, titles, xy axis labels, scales, and pins. Users can also limit the clustering view to specific, movable regions.


* *[GIF PLACEHOLDER: Insert an animated GIF showing real-time clustering adjustments, region limitations, and cluster merging]*

### Filtering & Search

Users can narrow down data points using a robust set of filters:

* Years, Keywords, Authors, Journals, Titles, and specific Instruments.


* FAISS Query Embeddings, raw queries, specific databases, and distinct metadata/chunks/papers.



### Meta Panel & Exporting

* **Card & Info Views**: The Meta Panel displays all points currently on the plot as clickable cards, which route to an Info View. The Info View shows comprehensive paper information, allows DOI searches, and finds similar papers.


* **Export Options**: Save the current plot state as a PNG, export data points as a CSV, and export/load previous plot states.


* *[IMAGE PLACEHOLDER: Insert a screenshot of the Meta Panel and Info View side-by-side]*

## Data Architecture

### Databases

The viewer consolidates and organizes data across three primary datasets:

* **Madrigal-9**: A sample dataset of 951 papers and 76,041 chunks citing Madrigal data from 1960 to 2026, collected across various sources.


* **AMISR-3**: Contains 347 papers and 21,468 chunks citing AMIRS data from 1971 to 2026, collected from the AMIRS site.


* **Arxiv**: Includes 3 million embedded abstracts from the Arxiv Kaggle dataset, tagged by area of study.



### Extraction Pipeline

* **PDF Processing**: Papers are processed as PDFs using PyMuPDF to extract both textual and visual components, successfully handling varying qualities including poor scans.


* **Data Storage**: Each paper and its corresponding data are stored in a SQLite Database table.


* **Chunking**: Text is sliced into roughly 5,000-character chunks. All chunks are cataloged in their own table and hold the ID of their parent paper.



### Metadata & LLM Extractions

Standard metadata extraction captures the Title, Authors, DOI, Date of Publication, Date added to DB, Keywords, Journal, References, and specific Instruments Used (ISR, TEC, FPI).

Through LLM processing, the application generates extended metadata, including:

* Standard and Mathematical Abstracts.


* Hypotheses, Methodology, and Phenomena Studied.


* Results, Limitations, Future Work, and conclusions based specifically on Madrigal Data.



## Models & AI Infrastructure

All language models are hosted locally via LM Studio on a laptop equipped with an RTX 5060 Laptop GPU. All embeddings generated are tagged by their embedding models.

* **Embedding Model**: Qwen 3 Embedding 0.6B.


* **LLMs**: Qwen Coder 14B Instruct, alongside LLama 3.2 3B Instruct utilized for app integrations.


* **GRU Network**: A basic regression network trained on a supervised dataset of Madrigal-9 embeddings. When fully integrated, this model calculates "jumps" to reach a specific goal, utilizing each jump as a section in a curriculum.



---

## Installation & Setup

*[Dummy Header: Insert prerequisites (e.g., Python version, SQLite), environment setup (e.g., `pip install -r requirements.txt`), and step-by-step installation instructions here. Outline exactly how to configure LM Studio ports and link the SQLite databases before initializing the Flask server.]*

## Usage & API Reference

*[Dummy Header: Provide terminal commands for running the app (e.g., `flask run`), the default local host port, and instructions for interacting with the UI. If there are exposed API endpoints for the FAISS queries or clustering models, document them here with examples.]*

## Contributing

*[Dummy Header: Outline guidelines for creating pull requests, formatting code, reporting bugs, or suggesting new features for the viewer.]*

## License

*[Dummy Header: Specify the project's license (e.g., MIT, GNU GPLv3) and any specific attribution requirements for the datasets used.]*
