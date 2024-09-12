#!/bin/bash

# List of cowsay modes
modes=(
    "beavis.zen" "blowfish" "bong" "bud-frogs" "bunny" "cheese" "cower" "daemon" "default" "dragon"
    "dragon-and-cow" "elephant" "elephant-in-snake" "eyes" "flaming-sheep" "ghostbusters" "head-in" 
    "hellokitty" "kiss" "kitty" "koala" "kosh" "luke-koala" "meow" "milk" "moofasa" "moose"
    "mutilated" "ren" "satanic" "sheep" "skeleton" "small" "sodomized" "stegosaurus" "stimpy"
    "supermilker" "surgery" "telebears" "three-eyes" "turkey" "turtle" "tux" "udder" "vader"
    "vader-koala" "www"
)

# Select a random mode
random_mode=${modes[$RANDOM % ${#modes[@]}]}

# Generate fortune message with cowsay
fortune_message=$(fortune | cowsay -f "$random_mode" -W 40)

# Run neofetch with the generated ASCII art
neofetch --ascii "$fortune_message"

