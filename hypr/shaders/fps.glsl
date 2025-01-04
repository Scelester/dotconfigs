precision highp float;

varying vec2 v_texcoord; // Texture coordinates
uniform sampler2D tex;   // Input texture
uniform float vibranceAmount; // Vibrance intensity (positive values increase vibrance)

void main() {
    vec4 pixColor = texture2D(tex, v_texcoord);
    vec3 color = pixColor.rgb;

    // Calculate luminance using perceptual coefficients
    vec3 luminanceCoeff = vec3(0.299, 0.587, 0.114);
    float luma = dot(color, luminanceCoeff);

    // Amplify the difference between the color and its luminance
    vec3 vibrance = mix(vec3(luma), color, 1.0 + vibranceAmount);

    // Output the final color
    gl_FragColor = vec4(vibrance, pixColor.a);
}
