#!/usr/bin/env bash
#
# generate_ai_resources.sh
# Generates a 4-week AI learning log in Obsidian,
# with daily files containing Read This + What You’ll Gain.

VAULT="$HOME/OBSIDIAN/"

# Define for each day: "Tag - Topic|Link|Description"
declare -A WEEK1=(
  [01]="Python - Crash Course|https://automatetheboringstuff.com/|Practical scripting skills to automate everyday tasks."             # :contentReference[oaicite:0]{index=0}
  [02]="NumPy - Basics|https://numpy.org/doc/stable/user/quickstart.html|Hands-on with arrays, ufuncs & broadcasting."           # :contentReference[oaicite:1]{index=1}
  [03]="Pandas - Intro|https://pandas.pydata.org/docs/user_guide/10min.html|Quick mastery of DataFrame creation & manipulation."  # :contentReference[oaicite:2]{index=2}
  [04]="Math - Basic Stats|https://www.khanacademy.org/math/statistics-probability/summarizing-quantitative-data-ap/measuring-spread-quantitative/v/sample-standard-deviation-and-bias|Intuitive grasp of variance vs. standard deviation."  # :contentReference[oaicite:3]{index=3}
  [05]="ML - Overview|https://scikit-learn.org/stable/user_guide.html|Survey of core ML algorithms & workflows."                   # :contentReference[oaicite:4]{index=4}
  [06]="Scikit-learn - Intro|https://scikit-learn.org/stable/getting_started.html|Step-by-step: install → load data → fit/predict."# :contentReference[oaicite:5]{index=5}
  [07]="Regression - Linear Regression|https://scikit-learn.org/stable/modules/linear_model.html|Understand OLS & regularization."   # :contentReference[oaicite:6]{index=6}
)

declare -A WEEK2=(
  [08]="Regression - Logistic Reg.|https://www.datacamp.com/tutorial/understanding-logistic-regression-python|Build a real-world classifier." # :contentReference[oaicite:7]{index=7}
  [09]="ML - Decision Trees|https://scikit-learn.org/stable/modules/tree.html|Learn tree-based splits & impurity measures."            # :contentReference[oaicite:8]{index=8}
  [10]="ML - Cross-Validation|https://scikit-learn.org/stable/modules/cross_validation.html|Master k-fold CV for robust evaluation."   # :contentReference[oaicite:9]{index=9}
  [11]="ML - Feature Scaling|https://scikit-learn.org/stable/modules/preprocessing.html#scaling-features|Why & how to normalize data."# :contentReference[oaicite:10]{index=10}
  [12]="ML - Pipelines|https://scikit-learn.org/stable/modules/generated/sklearn.pipeline.Pipeline.html|Chain steps: preprocess → model."# :contentReference[oaicite:11]{index=11}
  [13]="ML - Clustering|https://www.datacamp.com/tutorial/k-means-clustering-python|Cluster data with k-means & visualize results."   # :contentReference[oaicite:12]{index=12}
  [14]="Project - Mini ML Project|https://www.kaggle.com/c/titanic|Apply classification end-to-end on Titanic dataset."               # :contentReference[oaicite:13]{index=13}
)

declare -A WEEK3=(
  [15]="PyTorch - Tensors|https://pytorch.org/tutorials/beginner/basics/tensorqs_tutorial.html|Deep dive into torch.Tensor & ops."           # :contentReference[oaicite:14]{index=14}
  [16]="DL - Neural Net Theory|https://www.deeplearningbook.org/contents/ml.html|Core concepts: layers, activations, backpropagation."       # *(classic reference)*
  [17]="DL - Build First NN|https://pytorch.org/tutorials/beginner/nn_tutorial.html|Implement a network from scratch in PyTorch."           # :contentReference[oaicite:15]{index=15}
  [18]="DL - Optimizers|https://pytorch.org/docs/stable/optim.html|Compare SGD, Adam & tune learning rates."                                 # *(official docs)*
  [19]="DL - MNIST Classifier|https://pytorch.org/tutorials/beginner/blitz/neural_networks_tutorial.html|Train on image data end-to-end."     # *(official tutorial)*
  [20]="DL - CNN Basics|https://cs231n.github.io/convolutional-networks/|Intuition behind convolutional layers & feature maps."               # *(Stanford CS231n)*
  [21]="DL - CNN Practice|https://pytorch.org/tutorials/beginner/transfer_learning_tutorial.html|Fine-tune a pretrained model."               # :contentReference[oaicite:16]{index=16}
)

declare -A WEEK4=(
  [22]="DL - Transfer Learning|https://www.learnpytorch.io/06_pytorch_transfer_learning/|Leverage pretrained nets for new tasks."            # :contentReference[oaicite:17]{index=17}
  [23]="NLP - Transformers|https://huggingface.co/docs/transformers/en/quicktour|Get started with Hugging Face pipelines."                  # :contentReference[oaicite:18]{index=18}
  [24]="DL - Fine-tune Model|https://huggingface.co/blog/noob_intro_transformers|Fine-tune for sentiment, QA & more."                    # :contentReference[oaicite:19]{index=19}
  [25]="Time Series - Forecasting|https://www.datacamp.com/tutorial/tutorial-time-series-forecasting|Build ARIMA & ML time-series models."     # :contentReference[oaicite:20]{index=20}
  [26]="Project - Mini Project 1|https://www.kaggle.com/datasets|Pick a dataset & apply learned skills end-to-end."                       # *(Kaggle Datasets)*
  [27]="Project - Mini Project 2|https://www.analyticsvidhya.com/blog/2021/07/time-series-forecasting-complete-tutorial-part-1/|Deep dive into forecasting." # :contentReference[oaicite:21]{index=21}
  [28]="Project - Polish Project|https://www.datacamp.com/tutorial/data-cleaning-python|Best practices for cleaning & EDA."                 # *(Datacamp)*
  [29]="Career - Resume & GitHub|https://www.themuse.com/advice/data-scientist-resume-samples|Craft AI/ML-focused resumes & portfolios."   # *(The Muse)*
  [30]="Review - Recap & Roadmap|https://www.coursera.org/learn/machine-learning|Plan next steps with Andrew Ng’s classic ML course."      # *(Coursera ML)*
)

# Helper: write one day
write_day() {
  week=$1
  day=$2
  entry=$3
  IFS="|" read -r title link desc <<< "$entry"
  dir="$VAULT/Week-$(printf "%02d" $week)"
  mkdir -p "$dir"
  file="$dir/Day-$(printf "%02d" $day) - ${title}.md"

  cat > "$file" <<EOF
## 📚 Read This  
[$link]($link)

## 🎯 What You’ll Gain  
$desc

## 📝 Objective  
<!-- Define today’s learning goal -->

## 💡 What to Focus On  
<!-- Key concepts, formulas, code patterns -->

## 🚀 Study Sections

### 1. Concepts Learned  
<!-- Your detailed notes -->

### 2. Code / Practice  
<!-- Snippets & experiments -->

### 3. Review / Reflect  
<!-- Insights, questions, next steps -->
EOF
  echo "Created: $file"
}

# Generate all days
for d in "${!WEEK1[@]}"; do write_day 1 "$d" "${WEEK1[$d]}"; done
for d in "${!WEEK2[@]}"; do write_day 2 "$d" "${WEEK2[$d]}"; done
for d in "${!WEEK3[@]}"; do write_day 3 "$d" "${WEEK3[$d]}"; done
for d in "${!WEEK4[@]}"; do write_day 4 "$d" "${WEEK4[$d]}"; done

echo "✅ Your 30-day AI learning log is ready under: $VAULT"
